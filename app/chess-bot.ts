import type {
  ChessAction,
  ChessState,
  Color,
  PieceType,
} from "./chess-engine.ts";
import {
  getDeployTargets,
  getMoves,
  promotionRow,
  reduceChess,
  row,
} from "./chess-engine.ts";

export type BotAction = {
  type: "deploy" | "move";
  data: Record<string, unknown>;
};

const PIECE_VALUE: Record<PieceType, number> = {
  pawn: 1,
  knight: 3,
  bishop: 3,
  rook: 5,
  queen: 9,
};

export function getBotActions(state: ChessState, color: Color): BotAction[] {
  if (state.winner || state.turn !== color) return [];

  const actions: BotAction[] = [];
  const seenDeployTypes = new Set<PieceType>();
  for (const piece of state.reserves[color]) {
    // Identical reserve pieces have the same legal drops. Considering one ID
    // per type keeps the phone-side bot quick without changing its choices.
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

function scoreAction(state: ChessState, action: BotAction, color: Color) {
  const next = reduceChess(state, {
    ...action,
    data: { ...action.data, color, elapsedMs: 0 },
  } satisfies ChessAction);
  if (next === state) return Number.NEGATIVE_INFINITY;
  if (next.winner === color) return 1_000_000;

  let score = 0;
  if (action.type === "move") {
    const from = Number(action.data.from);
    const to = Number(action.data.to);
    const moving = state.board[from];
    const captured = state.board[to];
    if (captured) score += PIECE_VALUE[captured.type] * 1_000;
    if (moving?.type === "pawn" && row(to) === promotionRow(color)) score += 700;
    score += getMoves(next.board, to).length * 8;
  } else {
    const index = Number(action.data.index);
    const pieceId = String(action.data.pieceId);
    const piece = state.reserves[color].find((item) => item.id === pieceId);
    const centerDistance = Math.abs(row(index) - 1.5) + Math.abs((index % 4) - 1.5);
    score += (piece ? PIECE_VALUE[piece.type] : 0) * 10;
    score += Math.round((3 - centerDistance) * 12);
  }

  // Prefer positions that leave the bot with more immediate options. The
  // move-count tie breaker varies otherwise-equal openings deterministically.
  score += getBotActions(next, next.turn).length * -0.05;
  return score;
}

export function chooseBotAction(
  state: ChessState,
  color: Color = state.turn,
): BotAction | null {
  const actions = getBotActions(state, color);
  if (!actions.length) return null;

  let bestScore = Number.NEGATIVE_INFINITY;
  let best: BotAction[] = [];
  for (const action of actions) {
    const score = scoreAction(state, action, color);
    if (score > bestScore) {
      bestScore = score;
      best = [action];
    } else if (score === bestScore) {
      best.push(action);
    }
  }
  return best[state.moveCount % best.length] ?? null;
}
