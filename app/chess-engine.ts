export type Color = "white" | "black";
// The board game has exactly two piece types. A pawn that reaches the far rank
// becomes a Queen Pawn; there is no king, so nothing is ever in check.
export type PieceType = "pawn" | "queen";
export type Piece = { id: string; color: Color; type: PieceType };
export type Square = Piece | null;

export type ChessState = {
  schemaVersion: 2;
  board: Square[];
  reserves: Record<Color, Piece[]>;
  turn: Color;
  winner: Color | null;
  captures: Record<Color, number>;
  moveCount: number;
  lastAction: string;
};

export type ChessAction = {
  type: string;
  data?: Record<string, unknown>;
  playerId?: string;
  currentTurn?: string;
};

// One glyph per type, shared by both colours: the two armies must read as the
// same shapes and differ only in colour, so the fill comes from CSS.
export const GLYPHS: Record<PieceType, string> = { pawn: "♟", queen: "♛" };

export const NAMES: Record<PieceType, string> = {
  pawn: "Pawn",
  queen: "Queen Pawn",
};

export const RESERVE_SIZE = 8;

export const otherColor = (color: Color): Color =>
  color === "white" ? "black" : "white";
export const row = (index: number) => Math.floor(index / 4);
export const col = (index: number) => index % 4;
const inBounds = (r: number, c: number) => r >= 0 && r < 4 && c >= 0 && c < 4;

// White climbs towards row 0, black descends towards row 3.
export const forward = (color: Color) => (color === "white" ? -1 : 1);
export const promotionRow = (color: Color) => (color === "white" ? 0 : 3);

function createReserve(color: Color): Piece[] {
  return Array.from({ length: RESERVE_SIZE }, (_, index) => ({
    id: `${color}-pawn-${index}`,
    color,
    type: "pawn" as const,
  }));
}

export function createInitialChessState(): ChessState {
  return {
    schemaVersion: 2,
    board: Array(16).fill(null),
    reserves: { white: createReserve("white"), black: createReserve("black") },
    turn: "white",
    winner: null,
    captures: { white: 0, black: 0 },
    moveCount: 0,
    lastAction: "White deploys first",
  };
}

export function getMoves(board: Square[], from: number): number[] {
  const piece = board[from];
  if (!piece) return [];
  const r = row(from);
  const c = col(from);
  const moves: number[] = [];

  if (piece.type === "pawn") {
    const nr = r + forward(piece.color);
    if (inBounds(nr, c) && !board[nr * 4 + c]) moves.push(nr * 4 + c);
    for (const dc of [-1, 1]) {
      const nc = c + dc;
      if (!inBounds(nr, nc)) continue;
      const target = board[nr * 4 + nc];
      if (target && target.color !== piece.color) moves.push(nr * 4 + nc);
    }
    return moves;
  }

  for (const [dr, dc] of [
    [-1, 0], [1, 0], [0, -1], [0, 1],
    [-1, -1], [-1, 1], [1, -1], [1, 1],
  ]) {
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
  }
  return moves;
}

// A pawn may never be dropped straight onto the rank that would promote it —
// promotion has to be walked into.
export function canDeploy(board: Square[], color: Color, index: number): boolean {
  if (!Number.isInteger(index) || index < 0 || index > 15) return false;
  if (board[index]) return false;
  return row(index) !== promotionRow(color);
}

export function getDeployTargets(board: Square[], color: Color): number[] {
  return board.flatMap((_, index) => (canDeploy(board, color, index) ? [index] : []));
}

export function hasLegalAction(state: ChessState, color: Color): boolean {
  if (
    state.reserves[color].length > 0 &&
    getDeployTargets(state.board, color).length > 0
  ) {
    return true;
  }
  return state.board.some(
    (piece, index) =>
      piece?.color === color && getMoves(state.board, index).length > 0,
  );
}

const label = (color: Color) => (color === "white" ? "White" : "Black");

function finish(state: ChessState, color: Color, action: string): ChessState {
  const rival = otherColor(color);
  const next = { ...state, turn: rival, moveCount: state.moveCount + 1 };
  const rivalAlive =
    next.board.some((piece) => piece?.color === rival) ||
    next.reserves[rival].length > 0;

  // Last man standing: the rival loses once nothing of theirs is left, and also
  // when they still hold pieces but have no deploy square and no legal move —
  // otherwise the match would deadlock on a jammed board.
  if (!rivalAlive) {
    return { ...next, winner: color, lastAction: `${label(color)} wins!` };
  }
  if (!hasLegalAction(next, rival)) {
    return {
      ...next,
      winner: color,
      lastAction: `${label(rival)} has no move — ${label(color)} wins!`,
    };
  }
  return { ...next, winner: null, lastAction: action };
}

export function reduceChess(state: ChessState, action: ChessAction): ChessState {
  if (!state || state.schemaVersion !== 2) state = createInitialChessState();
  if (action.type === "reset" && state.winner) return createInitialChessState();
  const color = action.data?.color;
  if ((color !== "white" && color !== "black") || color !== state.turn || state.winner) {
    return state;
  }

  if (action.type === "deploy") {
    const index = Number(action.data?.index);
    const pieceId = String(action.data?.pieceId ?? "");
    if (!canDeploy(state.board, color, index)) return state;
    const piece = state.reserves[color].find((item) => item.id === pieceId);
    if (!piece) return state;
    const board = [...state.board];
    board[index] = piece;
    const next = {
      ...state,
      board,
      reserves: {
        ...state.reserves,
        [color]: state.reserves[color].filter((item) => item.id !== pieceId),
      },
    };
    return finish(next, color, `${label(color)} deployed a ${NAMES[piece.type]}`);
  }

  if (action.type === "move") {
    const from = Number(action.data?.from);
    const to = Number(action.data?.to);
    if (!Number.isInteger(from) || !Number.isInteger(to)) return state;
    const moving = state.board[from];
    if (!moving || moving.color !== color) return state;
    if (!getMoves(state.board, from).includes(to)) return state;
    const board = [...state.board];
    const captured = board[to];
    board[from] = null;
    const promoted = moving.type === "pawn" && row(to) === promotionRow(color);
    board[to] = promoted ? { ...moving, type: "queen" } : moving;
    const next = {
      ...state,
      board,
      captures: captured
        ? { ...state.captures, [color]: state.captures[color] + 1 }
        : state.captures,
    };
    const verb = captured
      ? `captured a ${NAMES[captured.type]}`
      : promoted
        ? "promoted a Queen Pawn"
        : `moved a ${NAMES[moving.type]}`;
    return finish(next, color, `${label(color)} ${verb}`);
  }
  return state;
}
