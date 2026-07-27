import assert from "node:assert/strict";
import test from "node:test";
import {
  RESERVE_SIZE,
  canDeploy,
  createInitialChessState,
  getDeployTargets,
  getMoves,
  reduceChess,
} from "../app/chess-engine.ts";

const apply = (state, type, data) => reduceChess(state, { type, data });

const empty = (overrides = {}) => ({
  ...createInitialChessState(),
  board: Array(16).fill(null),
  reserves: { white: [], black: [] },
  ...overrides,
});

test("both armies are pawns only — the variant has no king", () => {
  const state = createInitialChessState();
  assert.equal(state.board.length, 16);
  assert.equal(state.reserves.white.length, RESERVE_SIZE);
  assert.equal(state.reserves.black.length, RESERVE_SIZE);
  assert.ok(state.reserves.white.every((piece) => piece.type === "pawn"));
  assert.ok(state.reserves.black.every((piece) => piece.type === "pawn"));
  assert.equal(state.turn, "white");
});

test("deployments are ordered and reject an out-of-turn action", () => {
  const initial = createInitialChessState();
  const whitePawn = initial.reserves.white[0];
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

test("a pawn can never be dropped straight onto its promotion rank", () => {
  const initial = createInitialChessState();
  const whitePawn = initial.reserves.white[0];

  // White promotes on row 0, so squares 0–3 are off limits for a white drop.
  for (const index of [0, 1, 2, 3]) {
    assert.equal(canDeploy(initial.board, "white", index), false);
    assert.equal(
      apply(initial, "deploy", { color: "white", pieceId: whitePawn.id, index }),
      initial,
      `white must not deploy onto ${index}`,
    );
  }
  assert.equal(canDeploy(initial.board, "white", 4), true);

  // Black promotes on row 3, so squares 12–15 are off limits for black.
  for (const index of [12, 13, 14, 15]) {
    assert.equal(canDeploy(initial.board, "black", index), false);
  }
  assert.equal(canDeploy(initial.board, "black", 11), true);

  assert.deepEqual(getDeployTargets(initial.board, "white"), [
    4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
  ]);
  assert.equal(getDeployTargets(initial.board, "black").length, 12);
});

test("an occupied square is never a deploy target", () => {
  const state = empty();
  state.board[9] = { id: "black-pawn-0", color: "black", type: "pawn" };
  assert.equal(canDeploy(state.board, "white", 9), false);
  assert.equal(getDeployTargets(state.board, "white").includes(9), false);
});

test("pawns step forward and capture diagonally", () => {
  const state = empty();
  state.board[9] = { id: "white-pawn-0", color: "white", type: "pawn" };
  state.board[5] = { id: "black-pawn-0", color: "black", type: "pawn" };
  // Blocked straight ahead by the black pawn on 5; only the diagonals are open.
  state.board[4] = { id: "black-pawn-1", color: "black", type: "pawn" };
  assert.deepEqual(getMoves(state.board, 9).sort((a, b) => a - b), [4]);

  state.board[5] = null;
  assert.deepEqual(getMoves(state.board, 9).sort((a, b) => a - b), [4, 5]);
});

test("promotion produces a Queen Pawn that moves in every direction", () => {
  const state = empty({ turn: "white" });
  state.board[4] = { id: "white-pawn-0", color: "white", type: "pawn" };
  state.board[1] = { id: "black-pawn-0", color: "black", type: "pawn" };
  // A second black pawn keeps the match alive so the win check stays out of it.
  state.board[6] = { id: "black-pawn-1", color: "black", type: "pawn" };

  assert.deepEqual(getMoves(state.board, 4).sort((a, b) => a - b), [0, 1]);
  const result = apply(state, "move", { color: "white", from: 4, to: 1 });
  assert.equal(result.board[1]?.type, "queen");
  assert.equal(result.captures.white, 1);
  assert.equal(result.winner, null);

  // The promoted piece now slides like a queen along ranks, files and diagonals.
  const queenMoves = getMoves(result.board, 1);
  assert.ok(queenMoves.includes(0));
  assert.ok(queenMoves.includes(13));
  assert.ok(queenMoves.includes(4));
});

test("clearing the last rival piece wins the match", () => {
  const state = empty({ turn: "white" });
  state.board[4] = { id: "white-pawn-0", color: "white", type: "pawn" };
  state.board[1] = { id: "black-pawn-0", color: "black", type: "pawn" };

  const result = apply(state, "move", { color: "white", from: 4, to: 1 });
  assert.equal(result.winner, "white");
});

test("a rival left with no legal action loses instead of deadlocking", () => {
  const state = empty({ turn: "white" });
  // Black's only pawn is blocked straight ahead by a white pawn, and both
  // forward diagonals are empty so there is nothing to capture either.
  state.board[9] = { id: "black-pawn-0", color: "black", type: "pawn" };
  state.board[13] = { id: "white-pawn-0", color: "white", type: "pawn" };
  state.board[11] = { id: "white-pawn-1", color: "white", type: "pawn" };

  assert.deepEqual(getMoves(state.board, 9), []);
  const result = apply(state, "move", { color: "white", from: 11, to: 7 });
  assert.equal(result.winner, "white");
  assert.match(result.lastAction, /no move/);
});

test("stale schema versions are rebuilt instead of trusted", () => {
  const legacy = { schemaVersion: 1, board: [], reserves: {}, turn: "white" };
  const rebuilt = reduceChess(legacy, { type: "noop", data: {} });
  assert.equal(rebuilt.schemaVersion, 2);
  assert.equal(rebuilt.reserves.white.length, RESERVE_SIZE);
});
