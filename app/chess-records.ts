export const INITIAL_CHESS_RATING = 1200;
export const CHESS_RATING_K = 32;

type LeaderboardMe = {
  score: number | null;
  metadata?: Record<string, unknown> | null;
};

export type ChessLeaderboard = {
  me(): Promise<LeaderboardMe>;
  scores(userIds: string[]): Promise<Record<string, number | null>>;
  submit(
    score: number,
    metadata?: Record<string, unknown>,
  ): Promise<{ success: boolean; best: number }>;
};

export type ChessResultReporter = {
  reportResult(result: {
    winnerId: string;
    roomId: string;
    matchId: string;
  }): Promise<{ ok: boolean }>;
};

export type ChessRecordJob = {
  leaderboard: ChessLeaderboard;
  game: ChessResultReporter;
  roomId: string;
  sequence: number;
  userId: string;
  opponentId: string;
  winnerId: string;
  isHost: boolean;
};

const ratingOrInitial = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value)
    ? value
    : INITIAL_CHESS_RATING;

export function chessMatchId(roomId: string, sequence: number) {
  if (!roomId || !Number.isInteger(sequence) || sequence <= 0) {
    throw new Error("A finished match needs an authoritative room sequence.");
  }
  return `chess4:${roomId}:${sequence}`;
}

export function nextChessRating(
  rating: number,
  opponentRating: number,
  won: boolean,
) {
  const expected = 1 / (1 + 10 ** ((opponentRating - rating) / 400));
  return Math.round(rating + CHESS_RATING_K * ((won ? 1 : 0) - expected));
}

export async function saveChessRecord(job: ChessRecordJob) {
  const matchId = chessMatchId(job.roomId, job.sequence);
  const mine = await job.leaderboard.me();
  const alreadySaved = mine.metadata?.matchId === matchId;
  let rating = ratingOrInitial(mine.score);

  if (!alreadySaved) {
    const ratings = await job.leaderboard.scores([
      job.userId,
      job.opponentId,
    ]);
    const before = ratingOrInitial(ratings[job.userId] ?? mine.score);
    const opponentBefore = ratingOrInitial(ratings[job.opponentId]);
    const won = job.userId === job.winnerId;
    rating = nextChessRating(before, opponentBefore, won);
    const saved = await job.leaderboard.submit(rating, {
      format: "4x4-chess-rating-v1",
      matchId,
      opponentId: job.opponentId,
      outcome: won ? "win" : "loss",
      before,
      after: rating,
    });
    if (!saved?.success) throw new Error("The rating service rejected this result.");
  }

  // The backend deduplicates roomId + matchId, so a lost acknowledgement can
  // safely retry without creating a second Game Center result card.
  if (job.isHost) {
    const reported = await job.game.reportResult({
      winnerId: job.winnerId,
      roomId: job.roomId,
      matchId,
    });
    if (!reported?.ok) throw new Error("The match result was not accepted.");
  }

  return { matchId, rating, alreadySaved };
}
