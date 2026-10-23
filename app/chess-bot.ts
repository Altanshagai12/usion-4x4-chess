import type {
  ChessAction,
  ChessState,
  Color,
  Piece,
  PieceType,
} from "./chess-engine.ts";
import {
  col,
  getDeployTargets,
  getMoves,
  otherColor,
  reduceChess,
  row,
} from "./chess-engine.ts";

export type BotDifficulty = "easy" | "medium" | "hard";

export type BotAction = {
  type: "deploy" | "move";
  data: Record<string, unknown>;
};

export const BOT_DIFFICULTIES = {
  easy: {
    label: "EASY",
    description: "Careful basic play with occasional missed tactics.",
    depth: 1,
    branchLimit: 80,
    rootLimit: 80,
    choicePool: 4,
    nearBestWindow: 220,
  },
  medium: {
    label: "MEDIUM",
    description: "Anticipates your strongest immediate reply.",
    depth: 2,
    branchLimit: 20,
    rootLimit: 36,
    choicePool: 2,
    nearBestWindow: 90,
  },
  hard: {
    label: "HARD",
    description: "Calculates traps and counterplay several moves ahead.",
    depth: 4,
    branchLimit: 10,
    rootLimit: 26,
    choicePool: 1,
    nearBestWindow: 0,
  },
} as const;

const PIECE_VALUE: Record<PieceType, number> = {
  pawn: 1,
  knight: 3,
  bishop: 3,
  rook: 5,
  queen: 9,
};

function materialValue(piece: Piece) {
  return PIECE_VALUE[piece.type] * 100;
}

export function getBotActions(state: ChessState, color: Color): BotAction[] {
  if (state.winner || state.turn !== color) return [];

  const actions: BotAction[] = [];
  const seenDeployTypes = new Set<PieceType>();
  for (const piece of state.reserves[color]) {
    // Identical reserve pieces have the same legal drops. Considering one ID
    // per type keeps the search tree small without changing legal positions.
    if (seenDeployTypes.has(piece.type)) continue;
    seenDeployTypes.add(piece.type);
    for (const index of getDeployTargets(state.board, color, piece.type)) {
      actions.push({
        type: "deploy",
        data: { pieceId: piece.id, index },
      });
    }
  }

  state.board.forEach((piece, from) => {
    if (piece?.color !== color) return;
    for (const to of getMoves(state.board, from)) {
      actions.push({ type: "move", data: { from, to } });
    }
  });
  return actions;
}

function applyAction(state: ChessState, action: BotAction): ChessState {
  return reduceChess(state, {
    ...action,
    data: { ...action.data, color: state.turn, elapsedMs: 0 },
  } satisfies ChessAction);
}

function threatenedMaterial(state: ChessState, attacker: Color) {
  const threatened = new Set<number>();
  state.board.forEach((piece, from) => {
    if (piece?.color !== attacker) return;
    for (const target of getMoves(state.board, from)) {
      if (state.board[target]?.color === otherColor(attacker)) threatened.add(target);
    }
  });
  let value = 0;
  for (const index of threatened) {
    const piece = state.board[index];
    if (piece) value += materialValue(piece);
  }
  return value;
}

function positionalValue(state: ChessState, color: Color) {
  let value = 0;
  state.board.forEach((piece, index) => {
    if (piece?.color !== color) return;
    const centerDistance = Math.abs(row(index) - 1.5) + Math.abs(col(index) - 1.5);
    value += Math.round((3 - centerDistance) * 8);
    value += getMoves(state.board, index).length * 4;
    if (piece.type === "pawn") {
      const progress = color === "white" ? 3 - row(index) : row(index);
      value += progress * 18;
    }
  });
  return value;
}

export function evaluateBotPosition(state: ChessState, botColor: Color) {
  if (state.winner === botColor) return 1_000_000 - state.moveCount;
  if (state.winner === otherColor(botColor)) return -1_000_000 + state.moveCount;

  const rival = otherColor(botColor);
  const total = (color: Color) => [
    ...state.reserves[color],
    ...state.board.filter((piece): piece is Piece => piece?.color === color),
  ].reduce((sum, piece) => sum + materialValue(piece), 0);
  const botBoardCount = state.board.filter((piece) => piece?.color === botColor).length;
  const rivalBoardCount = state.board.filter((piece) => piece?.color === rival).length;

  return (
    (total(botColor) - total(rival)) * 10 +
    (threatenedMaterial(state, botColor) * 2 - threatenedMaterial(state, rival) * 3) +
    (positionalValue(state, botColor) - positionalValue(state, rival)) +
    (botBoardCount - rivalBoardCount) * 6 +
    (state.turn === botColor ? 4 : -4)
  );
}

type RankedAction = {
  action: BotAction;
  next: ChessState;
  score: number;
};

function rankActions(state: ChessState, botColor: Color): RankedAction[] {
  const maximizing = state.turn === botColor;
  return getBotActions(state, state.turn)
    .map((action) => {
      const next = applyAction(state, action);
      return { action, next, score: evaluateBotPosition(next, botColor) };
    })
    .filter(({ next }) => next !== state)
    .sort((left, right) => maximizing ? right.score - left.score : left.score - right.score);
}

function cacheKey(state: ChessState, depth: number, botColor: Color) {
  const board = state.board.map((piece) => piece ? `${piece.color[0]}${piece.type[0]}` : "-").join("");
  const reserve = (color: Color) => state.reserves[color]
    .map((piece) => piece.type[0])
    .sort()
    .join("");
  return `${depth}:${botColor}:${state.turn}:${board}:${reserve("white")}:${reserve("black")}`;
}

function minimax(
  state: ChessState,
  depth: number,
  botColor: Color,
  branchLimit: number,
  alpha: number,
  beta: number,
  cache: Map<string, number>,
): number {
  if (depth <= 0 || state.winner) return evaluateBotPosition(state, botColor);
  const key = cacheKey(state, depth, botColor);
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  const ranked = rankActions(state, botColor).slice(0, branchLimit);
  if (!ranked.length) return evaluateBotPosition(state, botColor);
  const maximizing = state.turn === botColor;
  let result = maximizing ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;

  for (const candidate of ranked) {
    const score = minimax(
      candidate.next,
      depth - 1,
      botColor,
      branchLimit,
      alpha,
      beta,
      cache,
    );
    if (maximizing) {
      result = Math.max(result, score);
      alpha = Math.max(alpha, result);
    } else {
      result = Math.min(result, score);
      beta = Math.min(beta, result);
    }
    if (beta <= alpha) break;
  }
  cache.set(key, result);
  return result;
}

export function chooseBotAction(
  state: ChessState,
  color: Color = state.turn,
  difficulty: BotDifficulty = "medium",
): BotAction | null {
  if (state.turn !== color || state.winner) return null;
  const config = BOT_DIFFICULTIES[difficulty];
  const cache = new Map<string, number>();
  const candidates = rankActions(state, color).slice(0, config.rootLimit);
  if (!candidates.length) return null;

  const scored = candidates.map((candidate) => ({
    action: candidate.action,
    score: config.depth === 1
      ? candidate.score
      : minimax(
          candidate.next,
          config.depth - 1,
          color,
          config.branchLimit,
          Number.NEGATIVE_INFINITY,
          Number.POSITIVE_INFINITY,
          cache,
        ),
  })).sort((left, right) => right.score - left.score);

  const bestScore = scored[0].score;
  const safePool = scored
    .filter((candidate) => candidate.score >= bestScore - config.nearBestWindow)
    .slice(0, config.choicePool);
  // Easy and Medium vary between near-equal choices, while never selecting a
  // blunder far below the best score. Hard always takes the calculated best.
  return safePool[state.moveCount % safePool.length]?.action ?? scored[0].action;
}
