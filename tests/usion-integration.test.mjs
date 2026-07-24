import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("pins the SDK v3 game transport and follows ordered-state recovery", async () => {
  const [layout, hook] = await Promise.all([
    readFile(new URL("app/layout.tsx", root), "utf8"),
    readFile(new URL("app/useUsionGame.ts", root), "utf8"),
  ]);

  assert.match(layout, /3\.0\.0-next\.7\/usion-sdk\.js/);
  assert.match(hook, /capabilities:\s*\["game"\]/);
  assert.ok(hook.indexOf("createState(") < hook.indexOf("game.join("));
  assert.match(hook, /checkpointEvery:\s*4/);
  assert.match(hook, /authority:\s*"host"/);
  assert.match(hook, /game\.onStatus/);
  assert.match(hook, /game\.recover/);
  assert.match(hook, /nextTurn/);
  assert.match(hook, /queueIfOffline:\s*true/);
});

test("online actions wait for the shared-state echo", async () => {
  const game = await readFile(new URL("app/Game.tsx", root), "utf8");
  assert.match(game, /if \(usion\.active\) \{\s*await usion\.commit/);
  assert.match(game, /const state = usion\.active \? usion\.state : localState/);
});
