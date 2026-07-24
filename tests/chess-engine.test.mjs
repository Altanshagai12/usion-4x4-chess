import assert from "node:assert/strict";
import test from "node:test";
import {
  createInitialChessState,
  getMoves,
  reduceChess,
} from "../app/chess-engine.ts";

const apply = (state, type, data) => reduceChess(state, { type, data });

test("starts with the reference fourteen-piece reserves", () => {
  const state = createInitialChessState();
  assert.equal(state.board.length, 16);
  assert.equal(state.reserves.white.length, 14);
  assert.equal(state.reserves.black.length, 14);
  assert.equal(state.turn, "white");
});

test("deployments are ordered and reject an out-of-turn action", () => {
  const initial = createInitialChessState();
  const whitePawn = initial.reserves.white.find((piece) => piece.type === "pawn");
  const afterWhite = apply(initial, "deploy", {
    color: "white",
    pieceId: whitePawn.id,
    index: 12,
  });
  assert.equal(afterWhite.board[12]?.color, "white");
  assert.equal(afterWhite.turn, "black");

  const replayedWhite = apply(afterWhite, "deploy", {
    color: "white",
    pieceId: whitePawn.id,
    index: 13,
  });
  assert.equal(replayedWhite, afterWhite);
});

test("standard movement captures and pawn promotion are deterministic", () => {
  const base = createInitialChessState();
  const promoted = {
    ...base,
    board: Array(16).fill(null),
    reserves: { white: [], black: [] },
    turn: "white",
  };
  promoted.board[4] = { id: "white-pawn", color: "white", type: "pawn" };
  promoted.board[1] = { id: "black-rook", color: "black", type: "rook" };

  assert.deepEqual(getMoves(promoted.board, 4).sort(), [0, 1]);
  const result = apply(promoted, "move", { color: "white", from: 4, to: 1 });
  assert.equal(result.board[1]?.type, "queen");
  assert.equal(result.captures.white, 1);
  assert.equal(result.winner, "white");
});
