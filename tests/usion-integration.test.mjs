import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("uses the public Usion SDK and reconnect-safe ordered state", async () => {
  const [layout, hook] = await Promise.all([
    readFile(new URL("app/layout.tsx", root), "utf8"),
    readFile(new URL("app/useUsionGame.ts", root), "utf8"),
  ]);

  assert.match(layout, /https:\/\/usions\.com\/usion-sdk\.js/);
  assert.match(hook, /usion\.init\(\{\s*timeout:\s*8_000\s*\}\)/);
  assert.ok(hook.indexOf("syncedState(") < hook.indexOf("game.join("));
  assert.match(hook, /game\.connect\(\)/);
  assert.match(hook, /game\.join\(roomId\)/);
  assert.match(hook, /game\.onJoined/);
  assert.match(hook, /game\.onPlayerJoined/);
  assert.match(hook, /game\.onPlayerLeft/);
  assert.match(hook, /game\.onRoomAssigned/);
  assert.match(hook, /game\.onConnectionState/);
  assert.match(hook, /game\.onReconnected/);
  assert.match(hook, /checkpointEvery:\s*1/);
  assert.match(hook, /authority:\s*"host"/);
  assert.match(hook, /nextTurn/);
  assert.match(hook, /queueOffline:\s*true/);
  assert.doesNotMatch(hook, /game\.emit|Usion\.ready|user\.info/);
});

test("online actions wait for the shared-state echo", async () => {
  const game = await readFile(new URL("app/Game.tsx", root), "utf8");
  assert.match(game, /if \(usion\.active\) \{\s*await usion\.commit/);
  assert.match(game, /const state = usion\.active \? usion\.state : localState/);
});
