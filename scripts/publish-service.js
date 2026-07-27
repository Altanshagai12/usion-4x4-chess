// Registers this game with the Usion service registry.
//
// Nothing is added to `usionthemobile`: the platform discovers the game purely
// from its registry entry, and the iframe is hosted from this repository. The
// script is idempotent — it updates the existing service when one is found and
// registers a new one otherwise.
//
//   USION_API_TOKEN      scoped creator token (usion_sk_…), never committed
//   USION_SERVICE_URL    https origin this game is deployed on
//   USION_SERVICE_ID     optional; target an existing service id directly
//   USION_SERVICE_IMAGE  optional public https PNG used as the catalog image

const API_ORIGIN = "https://mobile.mongolai.mn";
const REQUEST_TIMEOUT_MS = 20_000;

// `multiplayer.profile: "state"` is the load-bearing field. It pins the match
// to the platform relay, which is the transport `Usion.game.syncedState` needs.
// Registering the same tags WITHOUT it makes the registry treat this as a
// direct-mode game and auto-derive `realtime.ws_url` as wss://<iframe host> —
// a game server this repository never deploys, so every room would fail to
// connect. The profile also pins max/min players at 2 for the seat assignment
// in `app/useUsionGame.ts` (seat one white, seat two black).
const SERVICE = Object.freeze({
  name: "4×4 Chess: Last Man Stand",
  description:
    "Deploy a piece from your tray or move one already on the 4×4 board. No " +
    "check, no checkmate — capture every rival piece, kings included, to be " +
    "the last player standing. Two players, two phones.",
  service_type: "game",
  cost: 0,
  tags: Object.freeze([
    "game",
    "multiplayer",
    "iframe",
    "strategy",
    "turn-based",
    "chess",
  ]),
  is_published: true,
  // Chess has no score, so the leaderboard/records loop stays off deliberately.
  multiplayer: Object.freeze({ profile: "state", maxPlayers: 2 }),
});

export function readSettings(env = process.env, { requireToken = true } = {}) {
  const id = String(env.USION_SERVICE_ID || "").trim();
  const url = String(env.USION_SERVICE_URL || "").trim().replace(/\/+$/, "");
  const image = String(env.USION_SERVICE_IMAGE || "").trim();
  const token = String(env.USION_API_TOKEN || "").trim();

  if (!/^https:\/\/[^\s/]+$/.test(url)) {
    throw new Error(
      "Set USION_SERVICE_URL to the https origin this game is deployed on.",
    );
  }
  if (id && !/^[A-Za-z0-9][A-Za-z0-9_-]{2,}$/.test(id)) {
    throw new Error("USION_SERVICE_ID must be an existing Usion service id.");
  }
  if (image && !/^https:\/\/\S+\.png$/i.test(image)) {
    throw new Error("USION_SERVICE_IMAGE must be a public https PNG url.");
  }
  if (requireToken && !/^usion_sk_[A-Za-z0-9_-]{20,}$/.test(token)) {
    throw new Error(
      "Set a valid USION_API_TOKEN environment variable before publishing.",
    );
  }
  return { id, url, image, token };
}

export function servicePayload(settings) {
  const payload = {
    name: SERVICE.name,
    description: SERVICE.description,
    service_type: SERVICE.service_type,
    iframe_url: `${settings.url}/`,
    cost: SERVICE.cost,
    tags: [...SERVICE.tags],
    is_published: SERVICE.is_published,
    multiplayer: { ...SERVICE.multiplayer },
  };
  if (settings.image) payload.image = settings.image;
  return payload;
}

async function expectJson(response, action) {
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    throw new Error(
      `${action} failed (${response.status}): ${detail || response.statusText}`,
    );
  }
  return response.json();
}

function authorized(token, body) {
  return {
    method: body.method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body.payload),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  };
}

// The registry generates service ids, so an explicit id wins and otherwise the
// game is matched by name among the token owner's services. Without this the
// script would register a duplicate entry on every run.
async function findExistingId(settings, fetchImpl) {
  if (settings.id) return settings.id;
  const mine = await expectJson(
    await fetchImpl(`${API_ORIGIN}/registry/services/my`, {
      headers: { Authorization: `Bearer ${settings.token}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    }),
    "Listing your services",
  );
  return mine.find((service) => service.name === SERVICE.name)?.id ?? "";
}

// The registry is authoritative about the transport it derived, so the run only
// succeeds once the public catalog agrees the entry is a 2-seat platform-relay
// match. A stray `realtime` block means the entry fell back to direct mode.
function assertPublished(entry, payload) {
  if (!entry) {
    throw new Error("The public registry has not returned the entry yet.");
  }
  if (entry.iframe_url !== payload.iframe_url) {
    throw new Error(
      `Registry iframe_url is ${entry.iframe_url ?? "missing"}, expected ${payload.iframe_url}.`,
    );
  }
  if (entry.multiplayer?.profile !== "state") {
    throw new Error(
      `Registry multiplayer profile is ${entry.multiplayer?.profile ?? "missing"}, expected state.`,
    );
  }
  if (entry.realtime) {
    throw new Error(
      "Registry attached a realtime transport; syncedState needs the platform relay.",
    );
  }
  const seats = entry.game_config ?? {};
  if (seats.max_players !== 2 || seats.min_players !== 2) {
    throw new Error(
      `Registry seats are ${seats.min_players ?? "?"}–${seats.max_players ?? "?"}, expected 2–2.`,
    );
  }
  return entry;
}

export async function publishService({
  env = process.env,
  fetchImpl = fetch,
  argv = process.argv,
} = {}) {
  const dryRun = argv.includes("--dry-run");
  const settings = readSettings(env, { requireToken: !dryRun });
  const payload = servicePayload(settings);
  if (dryRun) return { ...payload, id: settings.id, dryRun: true };

  const existingId = await findExistingId(settings, fetchImpl);
  const registered = await expectJson(
    existingId
      ? await fetchImpl(
          `${API_ORIGIN}/registry/services/my/${existingId}`,
          authorized(settings.token, { method: "PUT", payload }),
        )
      : await fetchImpl(
          `${API_ORIGIN}/registry/services/register`,
          authorized(settings.token, { method: "POST", payload }),
        ),
    existingId ? `Updating ${SERVICE.name}` : `Registering ${SERVICE.name}`,
  );

  const services = await expectJson(
    await fetchImpl(`${API_ORIGIN}/registry/services`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    }),
    "Public registry verification",
  );
  const entry = assertPublished(
    services.find((service) => service.id === registered.id),
    payload,
  );
  return { ...entry, created: !existingId };
}

const invokedDirectly = process.argv[1]?.endsWith("publish-service.js");
if (invokedDirectly) {
  publishService()
    .then((service) => {
      const verb = service.dryRun
        ? "Ready"
        : service.created
          ? "Registered"
          : "Updated";
      console.log(`${verb} ${SERVICE.name}: ${service.iframe_url}`);
      if (service.id) console.log(`  service id: ${service.id}`);
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}

export { API_ORIGIN, SERVICE };
