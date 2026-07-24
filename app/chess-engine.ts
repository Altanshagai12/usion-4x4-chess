export type Color = "white" | "black";
export type PieceType = "pawn" | "rook" | "knight" | "bishop" | "king" | "queen";
export type Piece = { id: string; color: Color; type: PieceType };
export type Square = Piece | null;

export type ChessState = {
  schemaVersion: 1;
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

export const GLYPHS: Record<Color, Record<PieceType, string>> = {
  white: { pawn: "♙", rook: "♖", knight: "♘", bishop: "♗", king: "♔", queen: "♕" },
  black: { pawn: "♟", rook: "♜", knight: "♞", bishop: "♝", king: "♚", queen: "♛" },
};

export const NAMES: Record<PieceType, string> = {
  pawn: "Pawn",
  rook: "Rook",
  knight: "Knight",
  bishop: "Bishop",
  king: "King",
  queen: "Queen Pawn",
};

export const RESERVE_ORDER: PieceType[] = [
  "rook", "knight", "bishop", "king", "bishop", "knight", "rook",
  "pawn", "pawn", "pawn", "pawn", "pawn", "pawn", "pawn",
];

export const otherColor = (color: Color): Color =>
  color === "white" ? "black" : "white";
export const row = (index: number) => Math.floor(index / 4);
export const col = (index: number) => index % 4;
const inBounds = (r: number, c: number) => r >= 0 && r < 4 && c >= 0 && c < 4;

function createReserve(color: Color): Piece[] {
  return RESERVE_ORDER.map((type, index) => ({
    id: `${color}-${type}-${index}`,
    color,
    type,
  }));
}

export function createInitialChessState(): ChessState {
  return {
    schemaVersion: 1,
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
    const direction = piece.color === "white" ? -1 : 1;
    const nr = r + direction;
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
  if (piece.type === "king") {
    for (let dr = -1; dr <= 1; dr += 1) {
      for (let dc = -1; dc <= 1; dc += 1) if (dr || dc) addStep(r + dr, c + dc);
    }
  }
  if (piece.type === "rook" || piece.type === "queen") {
    for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) addRay(dr, dc);
  }
  if (piece.type === "bishop" || piece.type === "queen") {
    for (const [dr, dc] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) addRay(dr, dc);
  }
  return moves;
}

function finish(state: ChessState, color: Color, action: string): ChessState {
  const rival = otherColor(color);
  const rivalAlive =
    state.board.some((piece) => piece?.color === rival) ||
    state.reserves[rival].length > 0;
  return {
    ...state,
    turn: rival,
    winner: rivalAlive ? null : color,
    moveCount: state.moveCount + 1,
    lastAction: rivalAlive ? action : `${color === "white" ? "White" : "Black"} wins!`,
  };
}

export function reduceChess(state: ChessState, action: ChessAction): ChessState {
  if (!state || state.schemaVersion !== 1) state = createInitialChessState();
  if (action.type === "reset" && state.winner) return createInitialChessState();
  const color = action.data?.color;
  if ((color !== "white" && color !== "black") || color !== state.turn || state.winner) {
    return state;
  }

  if (action.type === "deploy") {
    const index = Number(action.data?.index);
    const pieceId = String(action.data?.pieceId ?? "");
    if (!Number.isInteger(index) || index < 0 || index > 15 || state.board[index]) return state;
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
    return finish(next, color, `${color === "white" ? "White" : "Black"} deployed a ${NAMES[piece.type]}`);
  }

  if (action.type === "move") {
    const from = Number(action.data?.from);
    const to = Number(action.data?.to);
    if (!Number.isInteger(from) || !Number.isInteger(to) || !getMoves(state.board, from).includes(to)) {
      return state;
    }
    const moving = state.board[from];
    if (!moving || moving.color !== color) return state;
    const board = [...state.board];
    const captured = board[to];
    board[from] = null;
    const promoted =
      moving.type === "pawn" &&
      ((color === "white" && row(to) === 0) || (color === "black" && row(to) === 3));
    board[to] = promoted ? { ...moving, type: "queen" } : moving;
    const next = {
      ...state,
      board,
      captures: captured
        ? { ...state.captures, [color]: state.captures[color] + 1 }
        : state.captures,
    };
    const verb = captured
      ? `captured ${NAMES[captured.type]}`
      : promoted ? "promoted a pawn" : `moved ${NAMES[moving.type]}`;
    return finish(next, color, `${color === "white" ? "White" : "Black"} ${verb}`);
  }
  return state;
}
