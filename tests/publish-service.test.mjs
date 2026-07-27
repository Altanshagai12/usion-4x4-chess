import assert from "node:assert/strict";
import test from "node:test";

import {
  API_ORIGIN,
  SERVICE,
  publishService,
  readSettings,
  servicePayload,
} from "../scripts/publish-service.js";

const env = {
  USION_SERVICE_URL: "https://usion-4x4-chess.example.com/",
  USION_API_TOKEN: "usion_sk_0123456789abcdefghijklmno",
};

const registryEntry = {
  id: "usion-4x4-chess-1f2e3d",
  name: SERVICE.name,
  iframe_url: "https://usion-4x4-chess.example.com/",
  multiplayer: { profile: "state", maxPlayers: 2 },
  game_config: { room_mode: "match", max_players: 2, min_players: 2 },
};

function stubFetch(routes, seen = []) {
  return async (url, options = {}) => {
    const method = options.method ?? "GET";
    seen.push([url, method]);
    const handler = routes[`${method} ${url}`];
    if (!handler) throw new Error(`unexpected request: ${method} ${url}`);
    const body = typeof handler === "function" ? handler(options) : handler;
    return { ok: true, json: async () => body };
  };
}

test("settings are validated before anything is sent", () => {
  assert.throws(
    () => readSettings({ ...env, USION_SERVICE_URL: "http://insecure.example" }),
    /USION_SERVICE_URL/,
  );
  assert.throws(
    () => readSettings({ ...env, USION_API_TOKEN: "nope" }),
    /USION_API_TOKEN/,
  );
  assert.throws(
    () => readSettings({ ...env, USION_SERVICE_ID: "??" }),
    /USION_SERVICE_ID/,
  );
  assert.throws(
    () => readSettings({ ...env, USION_SERVICE_IMAGE: "https://x.example/i.gif" }),
    /PNG/,
  );
  assert.equal(readSettings(env).url, "https://usion-4x4-chess.example.com");
});

test("the payload keeps the match on the platform relay", () => {
  const payload = servicePayload(readSettings(env));

  assert.equal(payload.iframe_url, "https://usion-4x4-chess.example.com/");
  assert.equal(payload.service_type, "game");
  assert.equal(payload.cost, 0);
  assert.deepEqual(payload.multiplayer, { profile: "state", maxPlayers: 2 });
  // A `realtime` block would move the game to direct mode and break syncedState.
  assert.equal(payload.realtime, undefined);
  assert.equal(payload.leaderboard, undefined);
  assert.ok(payload.tags.includes("game"));
  assert.ok(payload.tags.includes("multiplayer"));
  assert.equal(payload.image, undefined);

  const withImage = servicePayload(
    readSettings({ ...env, USION_SERVICE_IMAGE: "https://x.example/icon.png" }),
  );
  assert.equal(withImage.image, "https://x.example/icon.png");
});

test("a dry run needs no token and sends nothing", async () => {
  const calls = [];
  const result = await publishService({
    env: { ...env, USION_API_TOKEN: "" },
    fetchImpl: (...args) => {
      calls.push(args);
      throw new Error("should not fetch");
    },
    argv: ["node", "publish-service.js", "--dry-run"],
  });

  assert.equal(calls.length, 0);
  assert.equal(result.dryRun, true);
  assert.equal(result.multiplayer.profile, "state");
});

test("an unregistered game is registered, then verified publicly", async () => {
  const seen = [];
  const service = await publishService({
    env,
    argv: ["node", "publish-service.js"],
    fetchImpl: stubFetch(
      {
        [`GET ${API_ORIGIN}/registry/services/my`]: [],
        [`POST ${API_ORIGIN}/registry/services/register`]: registryEntry,
        [`GET ${API_ORIGIN}/registry/services`]: [registryEntry],
      },
      seen,
    ),
  });

  assert.deepEqual(seen, [
    [`${API_ORIGIN}/registry/services/my`, "GET"],
    [`${API_ORIGIN}/registry/services/register`, "POST"],
    [`${API_ORIGIN}/registry/services`, "GET"],
  ]);
  assert.equal(service.created, true);
  assert.equal(service.id, registryEntry.id);
});

test("an existing game is updated in place instead of duplicated", async () => {
  const seen = [];
  let sent;
  const service = await publishService({
    env,
    argv: ["node", "publish-service.js"],
    fetchImpl: stubFetch(
      {
        [`GET ${API_ORIGIN}/registry/services/my`]: [registryEntry],
        [`PUT ${API_ORIGIN}/registry/services/my/${registryEntry.id}`]: (
          options,
        ) => {
          sent = JSON.parse(options.body);
          return registryEntry;
        },
        [`GET ${API_ORIGIN}/registry/services`]: [registryEntry],
      },
      seen,
    ),
  });

  assert.deepEqual(seen, [
    [`${API_ORIGIN}/registry/services/my`, "GET"],
    [`${API_ORIGIN}/registry/services/my/${registryEntry.id}`, "PUT"],
    [`${API_ORIGIN}/registry/services`, "GET"],
  ]);
  assert.equal(sent.multiplayer.profile, "state");
  assert.equal(service.created, false);
});

test("an explicit service id skips the lookup", async () => {
  const seen = [];
  await publishService({
    env: { ...env, USION_SERVICE_ID: registryEntry.id },
    argv: ["node", "publish-service.js"],
    fetchImpl: stubFetch(
      {
        [`PUT ${API_ORIGIN}/registry/services/my/${registryEntry.id}`]:
          registryEntry,
        [`GET ${API_ORIGIN}/registry/services`]: [registryEntry],
      },
      seen,
    ),
  });

  assert.deepEqual(seen, [
    [`${API_ORIGIN}/registry/services/my/${registryEntry.id}`, "PUT"],
    [`${API_ORIGIN}/registry/services`, "GET"],
  ]);
});

test("a direct-mode fallback fails the run instead of shipping broken rooms", async () => {
  const routes = (entry) => ({
    [`GET ${API_ORIGIN}/registry/services/my`]: [registryEntry],
    [`PUT ${API_ORIGIN}/registry/services/my/${registryEntry.id}`]: entry,
    [`GET ${API_ORIGIN}/registry/services`]: [entry],
  });

  await assert.rejects(
    publishService({
      env,
      argv: ["node", "publish-service.js"],
      fetchImpl: stubFetch(
        routes({
          ...registryEntry,
          realtime: { connection_mode: "direct", ws_url: "wss://nope.example" },
        }),
      ),
    }),
    /realtime transport/,
  );

  await assert.rejects(
    publishService({
      env,
      argv: ["node", "publish-service.js"],
      fetchImpl: stubFetch(
        routes({ ...registryEntry, multiplayer: null }),
      ),
    }),
    /expected state/,
  );

  await assert.rejects(
    publishService({
      env,
      argv: ["node", "publish-service.js"],
      fetchImpl: stubFetch(
        routes({
          ...registryEntry,
          game_config: { max_players: 10, min_players: 2 },
        }),
      ),
    }),
    /expected 2–2/,
  );
});

test("a registry entry that never appears publicly fails the run", async () => {
  await assert.rejects(
    publishService({
      env,
      argv: ["node", "publish-service.js"],
      fetchImpl: stubFetch({
        [`GET ${API_ORIGIN}/registry/services/my`]: [],
        [`POST ${API_ORIGIN}/registry/services/register`]: registryEntry,
        [`GET ${API_ORIGIN}/registry/services`]: [],
      }),
    }),
    /has not returned the entry yet/,
  );
});
