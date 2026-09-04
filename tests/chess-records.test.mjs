import assert from "node:assert/strict";
import test from "node:test";

import {
  chessMatchId,
  nextChessRating,
  saveChessRecord,
} from "../app/chess-records.ts";

test("equal 1200 ratings move to 1216 and 1184", () => {
  assert.equal(nextChessRating(1200, 1200, true), 1216);
  assert.equal(nextChessRating(1200, 1200, false), 1184);
});

test("the authoritative action sequence gives each rematch a stable id", () => {
  assert.equal(chessMatchId("room-1", 9), "chess4:room-1:9");
  assert.notEqual(chessMatchId("room-1", 9), chessMatchId("room-1", 12));
  assert.throws(() => chessMatchId("room-1", 0), /authoritative/);
});

test("a player saves only their own rating and the host reports once per attempt", async () => {
  const submitted = [];
  const reported = [];
  const leaderboard = {
    me: async () => ({ score: 1200 }),
    scores: async () => ({ host: 1200, guest: 1200 }),
    submit: async (score, metadata) => {
      submitted.push({ score, metadata });
      return { success: true, best: score };
    },
  };
  const game = {
    reportResult: async (result) => {
      reported.push(result);
      return { ok: true };
    },
  };

  const result = await saveChessRecord({
    leaderboard,
    game,
    roomId: "room-1",
    sequence: 9,
    userId: "host",
    opponentId: "guest",
    winnerId: "host",
    isHost: true,
  });

  assert.equal(result.rating, 1216);
  assert.equal(submitted.length, 1);
  assert.equal(submitted[0].metadata.matchId, "chess4:room-1:9");
  assert.equal(submitted[0].metadata.opponentId, "guest");
  assert.deepEqual(reported, [{
    winnerId: "host",
    roomId: "room-1",
    matchId: "chess4:room-1:9",
  }]);
});

test("retry after a lost acknowledgement does not submit the rating twice", async () => {
  let scoresCalled = false;
  let submitCalled = false;
  let reportCalled = false;
  const matchId = chessMatchId("room-1", 9);
  const result = await saveChessRecord({
    leaderboard: {
      me: async () => ({ score: 1216, metadata: { matchId } }),
      scores: async () => {
        scoresCalled = true;
        return {};
      },
      submit: async () => {
        submitCalled = true;
        return { success: true, best: 1216 };
      },
    },
    game: {
      reportResult: async () => {
        reportCalled = true;
        return { ok: true };
      },
    },
    roomId: "room-1",
    sequence: 9,
    userId: "host",
    opponentId: "guest",
    winnerId: "host",
    isHost: true,
  });

  assert.equal(result.alreadySaved, true);
  assert.equal(result.rating, 1216);
  assert.equal(scoresCalled, false);
  assert.equal(submitCalled, false);
  assert.equal(reportCalled, true);
});

test("a guest records the loss without creating a duplicate result card", async () => {
  let reported = false;
  const result = await saveChessRecord({
    leaderboard: {
      me: async () => ({ score: null }),
      scores: async () => ({ host: null, guest: null }),
      submit: async (score) => ({ success: true, best: score }),
    },
    game: {
      reportResult: async () => {
        reported = true;
        return { ok: true };
      },
    },
    roomId: "room-1",
    sequence: 9,
    userId: "guest",
    opponentId: "host",
    winnerId: "host",
    isHost: false,
  });

  assert.equal(result.rating, 1184);
  assert.equal(reported, false);
});
