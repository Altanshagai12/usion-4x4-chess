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

test("a second player arrives through the platform invite, never self-play", async () => {
  const [hook, game] = await Promise.all([
    readFile(new URL("app/useUsionGame.ts", root), "utf8"),
    readFile(new URL("app/Game.tsx", root), "utf8"),
  ]);

  // The platform owns the picker; the game must not draw room codes or its own
  // share sheet.
  assert.match(hook, /usion\.game\.invite\(\)/);
  assert.doesNotMatch(game, /room code|Room Code|matchmaking/i);
  assert.doesNotMatch(game, /LOCAL DEMO/);

  // A solo launch idles in the lobby and only enters a room once one is
  // assigned — and entering must actually join it.
  assert.match(hook, /setConnection\("lobby"\)/);
  assert.match(hook, /onRoomAssigned\(\(event\) => \{/);
  assert.match(hook, /if \(event\.roomId\) void enterRoom\(event\.roomId\)/);
  assert.ok(hook.indexOf("game.connect()") < hook.indexOf("game.join(roomId)"));

  // Inside Usions the primary action is the invite, not a local game.
  assert.match(game, /usion\.embedded/);
  assert.match(game, /INVITE A FRIEND/);
});

test("each player views the board from their own side", async () => {
  const game = await readFile(new URL("app/Game.tsx", root), "utf8");

  // Black must not play from the top of the board on their own phone: the
  // view rotates so your army is always the near side, with your tray under it.
  assert.match(game, /const seatColor: Color = usion\.userColor \?\? "white"/);
  assert.match(game, /const flipped = seatColor === "black"/);
  assert.match(game, /const viewIndex = \(slot: number\) => \(flipped \? 15 - slot : slot\)/);
  assert.match(game, /const index = viewIndex\(slot\);/);

  // Trays follow the same seating: opponent on top, you on the bottom.
  assert.match(game, /color=\{topColor\}/);
  assert.match(game, /color=\{seatColor\}/);
  assert.match(game, /const topColor = otherColor\(seatColor\)/);

  // Pawns stand in front of the back rank on both sides, which mirrors: your
  // pawn row is the tray's top row, the opponent's is their bottom row.
  assert.match(game, /pawnsFirst=\{false\}/);
  assert.match(game, /\n\s+pawnsFirst\n/);
});

test("the SDK boots inside the mobile WebView, not just an iframe", async () => {
  const hook = await readFile(new URL("app/useUsionGame.ts", root), "utf8");

  // The Usions phone app is a React Native WebView where window.parent ===
  // window. Gating setup on iframe-ness alone drops every phone session into
  // the offline fallback, which is what made the game hot-seat playable.
  assert.match(hook, /ReactNativeWebView/);
  assert.match(hook, /window\.parent !== window/);
  assert.doesNotMatch(hook, /if \(window\.parent === window\) return;/);
});

test("a hosted match is unplayable until both seats are connected", async () => {
  const [game, hook] = await Promise.all([
    readFile(new URL("app/Game.tsx", root), "utf8"),
    readFile(new URL("app/useUsionGame.ts", root), "utf8"),
  ]);

  // The board is live only on your own turn once hosted — never a local
  // alternating-turn fallback inside Usions.
  assert.match(
    game,
    /const canInteract = !winner && \(usion\.embedded \? usion\.canAct : true\)/,
  );
  // The lobby holds the screen until the match has actually started.
  assert.match(game, /if \(usion\.embedded && !usion\.started && screen !== "rules"\)/);
  assert.match(game, /players in the room/);

  // `started` latches on both seats being present, so a mid-match blip shows
  // the reconnect notice instead of bouncing players back to the lobby.
  assert.match(hook, /const ready = ids\.length >= 2;/);
  assert.match(hook, /if \(ready\) setStarted\(true\);/);
  // Being hosted is asserted before the SDK resolves, so a slow or failed SDK
  // can never fall back to offline play inside Usions.
  assert.ok(hook.indexOf("setEmbedded(true)") < hook.indexOf("while (!window.Usion"));
});
