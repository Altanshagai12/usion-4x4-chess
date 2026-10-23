import assert from "node:assert/strict";
import test from "node:test";
import {
  BOT_DIFFICULTIES,
  chooseBotAction,
  getBotActions,
} from "../app/chess-bot.ts";
import { createInitialChessState, reduceChess } from "../app/chess-engine.ts";

test("the bot always chooses a legal black action after White moves", () => {
  const initial = reduceChess(createInitialChessState(), {
    type: "start",
    data: { color: "white" },
  });
  const whitePawn = initial.reserves.white.find((piece) => piece.type === "pawn");
  const afterWhite = reduceChess(initial, {
    type: "deploy",
    data: { color: "white", pieceId: whitePawn.id, index: 12, elapsedMs: 500 },
  });

  const legal = getBotActions(afterWhite, "black");
  const choice = chooseBotAction(afterWhite, "black");
  assert.ok(choice);
  assert.ok(legal.some((action) => JSON.stringify(action) === JSON.stringify(choice)));

  const afterBot = reduceChess(afterWhite, {
    ...choice,
    data: { ...choice.data, color: "black", elapsedMs: 450 },
  });
  assert.equal(afterBot.turn, "white");
  assert.equal(afterBot.moveCount, 2);
  assert.equal(afterBot.clocks.black, 299_550);
});

test("the bot takes a high-value capture when one is available", () => {
  const state = {
    ...createInitialChessState(),
    board: Array(16).fill(null),
    reserves: { white: [], black: [] },
    turn: "black",
    clockRunning: true,
  };
  state.board[0] = { id: "black-rook", color: "black", type: "rook" };
  state.board[3] = { id: "white-queen", color: "white", type: "queen" };
  state.board[15] = { id: "white-pawn", color: "white", type: "pawn" };

  assert.deepEqual(chooseBotAction(state, "black"), {
    type: "move",
    data: { from: 0, to: 3 },
  });
});

test("the bot never acts for the side whose turn has not arrived", () => {
  const initial = createInitialChessState();
  assert.deepEqual(getBotActions(initial, "black"), []);
  assert.equal(chooseBotAction(initial, "black"), null);
});

test("Easy, Medium, and Hard use increasingly deeper calculation", () => {
  assert.deepEqual(Object.keys(BOT_DIFFICULTIES), ["easy", "medium", "hard"]);
  assert.ok(BOT_DIFFICULTIES.easy.depth < BOT_DIFFICULTIES.medium.depth);
  assert.ok(BOT_DIFFICULTIES.medium.depth < BOT_DIFFICULTIES.hard.depth);
  assert.ok(BOT_DIFFICULTIES.easy.choicePool > BOT_DIFFICULTIES.medium.choicePool);
  assert.equal(BOT_DIFFICULTIES.hard.choicePool, 1);
});

test("all three levels return legal moves without choosing from the whole tray blindly", () => {
  const initial = reduceChess(createInitialChessState(), {
    type: "start",
    data: { color: "white" },
  });
  const whitePawn = initial.reserves.white.find((piece) => piece.type === "pawn");
  const afterWhite = reduceChess(initial, {
    type: "deploy",
    data: { color: "white", pieceId: whitePawn.id, index: 12, elapsedMs: 500 },
  });
  const legal = getBotActions(afterWhite, "black");

  for (const level of ["easy", "medium", "hard"]) {
    const choice = chooseBotAction(afterWhite, "black", level);
    assert.ok(choice, `${level} should choose a move`);
    assert.ok(
      legal.some((action) => JSON.stringify(action) === JSON.stringify(choice)),
      `${level} must choose from the legal action set`,
    );
  }
});
