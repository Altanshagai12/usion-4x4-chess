export type Color = "white" | "black";
// No king in this variant — the crowned tray piece is a queen, and nothing is
// ever in check.
export type PieceType = "pawn" | "rook" | "knight" | "bishop" | "queen";
export type Piece = { id: string; color: Color; type: PieceType };
export type Square = Piece | null;
export type LastMove = {
  kind: "deploy" | "move" | "timeout";
  color: Color;
  from: number | null;
  to: number | null;
  pieceType?: PieceType;
};

export const GAME_DURATION_MS = 5 * 60_000;

export type ChessState = {
  schemaVersion: 6;
  board: Square[];
  reserves: Record<Color, Piece[]>;
  turn: Color;
  winner: Color | null;
  captures: Record<Color, number>;
  moveCount: number;
  lastAction: string;
  lastMove: LastMove | null;
  clocks: Record<Color, number>;
  turnStartedAt: number | null;
};

export type ChessAction = {
  type: string;
  data?: Record<string, unknown>;
  playerId?: string;
  currentTurn?: string;
};

// U+FE0E is the text-presentation selector. Without it iOS renders U+265F
// (BLACK CHESS PAWN) with the colour emoji font, which ignores `color` and
// `-webkit-text-stroke` — so on a phone every pawn came out the same dark
// glyph and the white army appeared to hold black pawns. It is the only chess
// code point with an emoji presentation, but the selector is applied to the
// whole set so no piece can regress the same way.
const AS_TEXT = "︎";

// One glyph per type, shared by both armies: the two sides must read as the
// same silhouettes and differ only in colour, so the fill comes from CSS. The
// solid code points are used for both because outline glyphs cannot be tinted.
export const GLYPHS: Record<PieceType, string> = {
  pawn: `♟${AS_TEXT}`,
  rook: `♜${AS_TEXT}`,
  knight: `♞${AS_TEXT}`,
  bishop: `♝${AS_TEXT}`,
  queen: `♛${AS_TEXT}`,
};

export const NAMES: Record<PieceType, string> = {
  pawn: "Pawn",
  rook: "Rook",
  knight: "Knight",
  bishop: "Bishop",
  queen: "Queen",
};

// Seven back-rank pieces over seven pawns, matching the tray the real game
// deals each player. The crowned centre piece is a queen — there is no king.
export const RESERVE_ORDER: PieceType[] = [
  "rook", "knight", "bishop", "queen", "bishop", "knight", "rook",
  "pawn", "pawn", "pawn", "pawn", "pawn", "pawn", "pawn",
];

export const otherColor = (color: Color): Color =>
  color === "white" ? "black" : "white";
export const row = (index: number) => Math.floor(index / 4);
export const col = (index: number) => index % 4;
const inBounds = (r: number, c: number) => r >= 0 && r < 4 && c >= 0 && c < 4;

// White climbs towards row 0, black descends towards row 3.
export const forward = (color: Color) => (color === "white" ? -1 : 1);
export const promotionRow = (color: Color) => (color === "white" ? 0 : 3);

function createReserve(color: Color): Piece[] {
  return RESERVE_ORDER.map((type, index) => ({
    id: `${color}-${type}-${index}`,
    color,
    type,
  }));
}

export function createInitialChessState(): ChessState {
  return {
    schemaVersion: 6,
    board: Array(16).fill(null),
    reserves: { white: createReserve("white"), black: createReserve("black") },
    turn: "white",
    winner: null,
    captures: { white: 0, black: 0 },
    moveCount: 0,
    lastAction: "White deploys first",
    lastMove: null,
    clocks: { white: GAME_DURATION_MS, black: GAME_DURATION_MS },
    turnStartedAt: null,
  };
}

export function getMoves(board: Square[], from: number): number[] {
  const piece = board[from];
  if (!piece) return [];
  const r = row(from);
  const c = col(from);
  const moves: number[] = [];
  const addStep = (nr: number, nc: number) => {
    if (!inBounds(nr, nc)) return;
    const target = board[nr * 4 + nc];
    if (!target || target.color !== piece.color) moves.push(nr * 4 + nc);
  };
  const addRay = (dr: number, dc: number) => {
    let nr = r + dr;
    let nc = c + dc;
    while (inBounds(nr, nc)) {
      const index = nr * 4 + nc;
      const target = board[index];
      if (!target) moves.push(index);
      else {
        if (target.color !== piece.color) moves.push(index);
        break;
      }
      nr += dr;
      nc += dc;
    }
  };

  if (piece.type === "pawn") {
    const nr = r + forward(piece.color);
    if (inBounds(nr, c) && !board[nr * 4 + c]) moves.push(nr * 4 + c);
    for (const dc of [-1, 1]) {
      const nc = c + dc;
      if (!inBounds(nr, nc)) continue;
      const target = board[nr * 4 + nc];
      if (target && target.color !== piece.color) moves.push(nr * 4 + nc);
    }
  }
  if (piece.type === "knight") {
    for (const [dr, dc] of [
      [-2, -1], [-2, 1], [-1, -2], [-1, 2],
      [1, -2], [1, 2], [2, -1], [2, 1],
    ]) addStep(r + dr, c + dc);
  }
  if (piece.type === "rook" || piece.type === "queen") {
    for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) addRay(dr, dc);
  }
  if (piece.type === "bishop" || piece.type === "queen") {
    for (const [dr, dc] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) addRay(dr, dc);
  }
  return moves;
}

// Any piece may be dropped on a free square, except that a pawn may never be
// dropped straight onto the rank that would promote it — promotion has to be
// walked into.
export function canDeploy(
  board: Square[],
  color: Color,
  index: number,
  type: PieceType,
): boolean {
  if (!Number.isInteger(index) || index < 0 || index > 15) return false;
  if (board[index]) return false;
  if (type === "pawn" && row(index) === promotionRow(color)) return false;
  return true;
}

export function getDeployTargets(
  board: Square[],
  color: Color,
  type: PieceType,
): number[] {
  return board.flatMap((_, index) =>
    canDeploy(board, color, index, type) ? [index] : [],
  );
}

export function hasLegalAction(state: ChessState, color: Color): boolean {
  const canDrop = state.reserves[color].some(
    (piece) => getDeployTargets(state.board, color, piece.type).length > 0,
  );
  if (canDrop) return true;
  return state.board.some(
    (piece, index) =>
      piece?.color === color && getMoves(state.board, index).length > 0,
  );
}

const label = (color: Color) => (color === "white" ? "White" : "Black");

function timestampFrom(
  data: Record<string, unknown> | undefined,
  key: "actedAt" | "startedAt",
): number | null {
  const timestamp = Number(data?.[key]);
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : null;
}

function remainingAt(state: ChessState, color: Color, at: number): number {
  if (state.turnStartedAt === null) return state.clocks[color];
  const elapsed = Math.max(0, at - state.turnStartedAt);
  return Math.max(0, state.clocks[color] - elapsed);
}

function loseOnTime(
  state: ChessState,
  color: Color,
  at: number,
): ChessState {
  const winner = otherColor(color);
  return {
    ...state,
    turn: winner,
    winner,
    clocks: { ...state.clocks, [color]: remainingAt(state, color, at) },
    moveCount: state.moveCount + 1,
    lastAction: `${label(winner)} wins on time!`,
    lastMove: {
      kind: "timeout",
      color,
      from: null,
      to: null,
    },
    turnStartedAt: null,
  };
}

function finish(
  state: ChessState,
  color: Color,
  action: string,
  lastMove: LastMove,
  turnStartedAt: number | null,
): ChessState {
  const rival = otherColor(color);
  const next = {
    ...state,
    turn: rival,
    moveCount: state.moveCount + 1,
    lastMove,
    turnStartedAt,
  };
  const rivalAlive =
    next.board.some((piece) => piece?.color === rival) ||
    next.reserves[rival].length > 0;

  // Last man standing: the rival loses once nothing of theirs is left, and also
  // when they still hold pieces but have no deploy square and no legal move —
  // otherwise the match would deadlock on a jammed board.
  if (!rivalAlive) {
    return {
      ...next,
      winner: color,
      lastAction: `${label(color)} wins!`,
      turnStartedAt: null,
    };
  }
  if (!hasLegalAction(next, rival)) {
    return {
      ...next,
      winner: color,
      lastAction: `${label(rival)} has no move — ${label(color)} wins!`,
      turnStartedAt: null,
    };
  }
  return { ...next, winner: null, lastAction: action };
}

export function reduceChess(state: ChessState, action: ChessAction): ChessState {
  if (!state || state.schemaVersion !== 6) state = createInitialChessState();
  const startedAt = timestampFrom(action.data, "startedAt");
  if (action.type === "reset" && state.winner) {
    return { ...createInitialChessState(), turnStartedAt: startedAt };
  }
  const color = action.data?.color;

  // Only the host/white seat starts both five-minute clocks. The active
  // player's remaining time is settled into shared state on every move.
  if (
    action.type === "start" &&
    color === "white" &&
    !state.winner &&
    state.turnStartedAt === null &&
    startedAt
  ) {
    return { ...state, turnStartedAt: startedAt };
  }

  if ((color !== "white" && color !== "black") || color !== state.turn || state.winner) {
    return state;
  }

  const suppliedAt = timestampFrom(action.data, "actedAt");
  if (state.turnStartedAt !== null && suppliedAt === null) return state;
  const actedAt =
    state.turnStartedAt === null
      ? suppliedAt
      : Math.max(suppliedAt ?? state.turnStartedAt, state.turnStartedAt);
  const remaining =
    actedAt === null ? state.clocks[color] : remainingAt(state, color, actedAt);

  if (action.type === "timeout") {
    if (actedAt === null || state.turnStartedAt === null || remaining > 0) {
      return state;
    }
    return loseOnTime(state, color, actedAt);
  }

  if (remaining <= 0 && actedAt !== null) {
    return loseOnTime(state, color, actedAt);
  }

  const timedState = {
    ...state,
    clocks: { ...state.clocks, [color]: remaining },
  };

  if (action.type === "deploy") {
    const index = Number(action.data?.index);
    const pieceId = String(action.data?.pieceId ?? "");
    const piece = timedState.reserves[color].find((item) => item.id === pieceId);
    if (!piece) return state;
    if (!canDeploy(timedState.board, color, index, piece.type)) return state;
    const board = [...timedState.board];
    board[index] = piece;
    const next = {
      ...timedState,
      board,
      reserves: {
        ...timedState.reserves,
        [color]: timedState.reserves[color].filter((item) => item.id !== pieceId),
      },
    };
    return finish(
      next,
      color,
      `${label(color)} deployed a ${NAMES[piece.type]}`,
      {
        kind: "deploy",
        color,
        from: null,
        to: index,
        pieceType: piece.type,
      },
      actedAt,
    );
  }

  if (action.type === "move") {
    const from = Number(action.data?.from);
    const to = Number(action.data?.to);
    if (!Number.isInteger(from) || !Number.isInteger(to)) return state;
    const moving = timedState.board[from];
    if (!moving || moving.color !== color) return state;
    if (!getMoves(timedState.board, from).includes(to)) return state;
    const board = [...timedState.board];
    const captured = board[to];
    board[from] = null;
    const promoted = moving.type === "pawn" && row(to) === promotionRow(color);
    board[to] = promoted ? { ...moving, type: "queen" } : moving;
    const next = {
      ...timedState,
      board,
      captures: captured
        ? {
            ...timedState.captures,
            [color]: timedState.captures[color] + 1,
          }
        : timedState.captures,
    };
    const verb = captured
      ? `captured a ${NAMES[captured.type]}`
      : promoted
        ? "promoted a Queen"
        : `moved a ${NAMES[moving.type]}`;
    return finish(
      next,
      color,
      `${label(color)} ${verb}`,
      {
        kind: "move",
        color,
        from,
        to,
        pieceType: promoted ? "queen" : moving.type,
      },
      actedAt,
    );
  }
  return state;
}
