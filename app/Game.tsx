"use client";

import { useCallback, useMemo, useState } from "react";

type Color = "white" | "black";
type PieceType = "pawn" | "rook" | "knight" | "bishop" | "king" | "queen";
type Screen = "home" | "rules" | "game";
type Piece = { id: string; color: Color; type: PieceType };
type Square = Piece | null;
type Selection =
  | { source: "board"; index: number }
  | { source: "reserve"; color: Color; id: string }
  | null;

const GLYPHS: Record<Color, Record<PieceType, string>> = {
  white: { pawn: "♙", rook: "♖", knight: "♘", bishop: "♗", king: "♔", queen: "♕" },
  black: { pawn: "♟", rook: "♜", knight: "♞", bishop: "♝", king: "♚", queen: "♛" },
};

const NAMES: Record<PieceType, string> = {
  pawn: "Pawn",
  rook: "Rook",
  knight: "Knight",
  bishop: "Bishop",
  king: "King",
  queen: "Queen Pawn",
};

const RESERVE_ORDER: PieceType[] = [
  "rook", "knight", "bishop", "king", "bishop", "knight", "rook",
  "pawn", "pawn", "pawn", "pawn", "pawn", "pawn", "pawn",
];

const RULES = [
  {
    title: "PUT PIECES INSIDE THE MAIN BOARD",
    copy: "On your turn, pick any piece from your tray and place it on an empty square.",
    art: "deploy",
  },
  {
    title: "MOVE & CAPTURE LIKE CHESS",
    copy: "Instead of deploying, move a piece already in play. There is no check or checkmate.",
    art: "capture",
  },
  {
    title: "PROMOTE & BE THE LAST STANDING",
    copy: "Reach the far edge with a pawn to make a Queen Pawn. Eliminate the entire rival army to win.",
    art: "win",
  },
] as const;

function createReserve(color: Color): Piece[] {
  return RESERVE_ORDER.map((type, index) => ({
    id: `${color}-${type}-${index}`,
    color,
    type,
  }));
}

const row = (index: number) => Math.floor(index / 4);
const col = (index: number) => index % 4;
const inBounds = (r: number, c: number) => r >= 0 && r < 4 && c >= 0 && c < 4;

function getMoves(board: Square[], from: number): number[] {
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
      const targetIndex = nr * 4 + nc;
      const target = board[targetIndex];
      if (!target) moves.push(targetIndex);
      else {
        if (target.color !== piece.color) moves.push(targetIndex);
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
      for (let dc = -1; dc <= 1; dc += 1) {
        if (dr || dc) addStep(r + dr, c + dc);
      }
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

function PieceGlyph({ piece, small = false }: { piece: Piece; small?: boolean }) {
  return (
    <span className={`piece-glyph piece-${piece.color}${small ? " piece-small" : ""}`} aria-hidden="true">
      {GLYPHS[piece.color][piece.type]}
    </span>
  );
}

function ReserveTray({
  color, pieces, active, selection, onSelect,
}: {
  color: Color;
  pieces: Piece[];
  active: boolean;
  selection: Selection;
  onSelect: (piece: Piece) => void;
}) {
  return (
    <section className={`reserve reserve-${color}${active ? " reserve-active" : ""}`} aria-label={`${color} reserve`}>
      <div className="reserve-label">
        <span>{color === "black" ? "PLAYER 2" : "PLAYER 1"}</span>
        <strong>{pieces.length}</strong>
      </div>
      <div className="reserve-grid">
        {Array.from({ length: 14 }, (_, index) => {
          const piece = pieces[index];
          if (!piece) return <span className="reserve-slot empty-slot" key={index} />;
          const selected = selection?.source === "reserve" && selection.id === piece.id;
          return (
            <button
              className={`reserve-slot${selected ? " selected" : ""}`}
              key={piece.id}
              onClick={() => onSelect(piece)}
              disabled={!active}
              aria-label={`Deploy ${color} ${NAMES[piece.type]}`}
              aria-pressed={selected}
            >
              <PieceGlyph piece={piece} small />
            </button>
          );
        })}
      </div>
    </section>
  );
}

export default function Game() {
  const [screen, setScreen] = useState<Screen>("home");
  const [rulePage, setRulePage] = useState(0);
  const [board, setBoard] = useState<Square[]>(() => Array(16).fill(null));
  const [reserves, setReserves] = useState<Record<Color, Piece[]>>(() => ({
    white: createReserve("white"),
    black: createReserve("black"),
  }));
  const [turn, setTurn] = useState<Color>("white");
  const [selection, setSelection] = useState<Selection>(null);
  const [winner, setWinner] = useState<Color | null>(null);
  const [soundOn, setSoundOn] = useState(true);
  const [captures, setCaptures] = useState<Record<Color, number>>({ white: 0, black: 0 });
  const [lastAction, setLastAction] = useState("White deploys first");

  const legalTargets = useMemo(() => {
    if (!selection) return [];
    if (selection.source === "reserve") {
      return board.flatMap((square, index) => (square ? [] : [index]));
    }
    return getMoves(board, selection.index);
  }, [board, selection]);

  const resetGame = useCallback(() => {
    setBoard(Array(16).fill(null));
    setReserves({ white: createReserve("white"), black: createReserve("black") });
    setTurn("white");
    setSelection(null);
    setWinner(null);
    setCaptures({ white: 0, black: 0 });
    setLastAction("White deploys first");
    setScreen("game");
  }, []);

  const finishTurn = useCallback((
    nextBoard: Square[],
    nextReserves: Record<Color, Piece[]>,
    action: string,
  ) => {
    const rival: Color = turn === "white" ? "black" : "white";
    const rivalOnBoard = nextBoard.some((piece) => piece?.color === rival);
    if (!rivalOnBoard && nextReserves[rival].length === 0) {
      setWinner(turn);
      setLastAction(`${turn === "white" ? "White" : "Black"} wins!`);
    } else {
      setTurn(rival);
      setLastAction(action);
    }
    setSelection(null);
  }, [turn]);

  const selectReserve = (piece: Piece) => {
    if (winner || piece.color !== turn) return;
    setSelection((current) =>
      current?.source === "reserve" && current.id === piece.id
        ? null
        : { source: "reserve", color: piece.color, id: piece.id },
    );
  };

  const selectSquare = (index: number) => {
    if (winner) return;
    const target = board[index];
    if (!selection) {
      if (target?.color === turn) setSelection({ source: "board", index });
      return;
    }

    if (selection.source === "reserve") {
      if (target || !legalTargets.includes(index)) {
        if (target?.color === turn) setSelection({ source: "board", index });
        return;
      }
      const piece = reserves[turn].find((item) => item.id === selection.id);
      if (!piece) return;
      const nextBoard = [...board];
      nextBoard[index] = piece;
      const nextReserves = {
        ...reserves,
        [turn]: reserves[turn].filter((item) => item.id !== piece.id),
      };
      setBoard(nextBoard);
      setReserves(nextReserves);
      finishTurn(nextBoard, nextReserves, `${turn === "white" ? "White" : "Black"} deployed a ${NAMES[piece.type]}`);
      return;
    }

    if (target?.color === turn) {
      setSelection({ source: "board", index });
      return;
    }
    if (!legalTargets.includes(index)) return;
    const moving = board[selection.index];
    if (!moving) return;
    const nextBoard = [...board];
    const captured = nextBoard[index];
    nextBoard[selection.index] = null;
    const destinationRow = row(index);
    const promoted =
      moving.type === "pawn" &&
      ((moving.color === "white" && destinationRow === 0) ||
        (moving.color === "black" && destinationRow === 3));
    nextBoard[index] = promoted ? { ...moving, type: "queen" } : moving;
    setBoard(nextBoard);
    if (captured) {
      setCaptures((current) => ({ ...current, [turn]: current[turn] + 1 }));
    }
    const verb = captured
      ? `captured ${NAMES[captured.type]}`
      : promoted ? "promoted a pawn" : `moved ${NAMES[moving.type]}`;
    finishTurn(nextBoard, reserves, `${turn === "white" ? "White" : "Black"} ${verb}`);
  };

  if (screen === "home") {
    return (
      <main className="game-shell home-screen">
        <section className="home-card">
          <div className="mini-board-logo" aria-hidden="true">
            {Array.from({ length: 16 }, (_, index) => (
              <span key={index}>{index === 2 ? "♜" : index === 13 ? "♙" : ""}</span>
            ))}
          </div>
          <p className="eyebrow">QUICK TACTICAL DUEL</p>
          <h1><span>4×4 CHESS</span><strong>LAST MAN STAND</strong></h1>
          <p className="home-copy">Deploy. Move. Capture. On this tiny board, every square changes the battle.</p>
          <div className="home-actions">
            <button className="primary-button" onClick={resetGame}><span aria-hidden="true">♟</span> 2 PLAYERS</button>
            <button className="secondary-button" onClick={() => setScreen("rules")}>HOW TO PLAY?</button>
          </div>
        </section>
        <button className="sound-button" onClick={() => setSoundOn((value) => !value)} aria-label={soundOn ? "Mute sound" : "Turn sound on"}>
          {soundOn ? "🔊" : "🔇"}
        </button>
      </main>
    );
  }

  if (screen === "rules") {
    const rule = RULES[rulePage];
    return (
      <main className="game-shell rules-screen">
        <section className="rules-card">
          <p className="rules-kicker">HOW TO PLAY?</p>
          <h2>{rule.title}</h2>
          <div className={`rules-art rules-art-${rule.art}`} aria-hidden="true">
            <div className="tiny-tray">
              {RESERVE_ORDER.slice(0, 7).map((type, index) => <span key={`${type}-${index}`}>{GLYPHS.black[type]}</span>)}
            </div>
            <div className="rules-board">
              {Array.from({ length: 16 }, (_, index) => (
                <span key={index}>
                  {rule.art === "capture" && index === 5 ? "♙" : ""}
                  {rule.art === "capture" && index === 10 ? "♟" : ""}
                  {rule.art === "win" && index === 2 ? "♕" : ""}
                </span>
              ))}
            </div>
            <div className="tutorial-arrow">➜</div>
          </div>
          <p>{rule.copy}</p>
          <div className="rule-dots" aria-label={`Rule ${rulePage + 1} of 3`}>
            {RULES.map((_, index) => <span className={index === rulePage ? "active" : ""} key={index} />)}
          </div>
          <div className="rules-actions">
            <button className="icon-button" onClick={() => rulePage === 0 ? setScreen("home") : setRulePage((page) => page - 1)} aria-label={rulePage === 0 ? "Back home" : "Previous rule"}>←</button>
            <button className="primary-button rules-next" onClick={() => {
              if (rulePage === RULES.length - 1) resetGame();
              else setRulePage((page) => page + 1);
            }}>{rulePage === RULES.length - 1 ? "PLAY NOW" : "NEXT"} →</button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="game-shell play-screen">
      <header className="game-header">
        <button className="icon-button" onClick={() => setScreen("home")} aria-label="Home">⌂</button>
        <div className="turn-pill" aria-live="polite">
          <span className={`turn-dot turn-${turn}`} />
          {winner ? `${winner === "white" ? "PLAYER 1" : "PLAYER 2"} WINS` : `${turn === "white" ? "PLAYER 1" : "PLAYER 2"}'S TURN`}
        </div>
        <button className="icon-button" onClick={() => setSoundOn((value) => !value)} aria-label={soundOn ? "Mute sound" : "Turn sound on"}>
          {soundOn ? "♪" : "×"}
        </button>
      </header>

      <div className="game-stage">
        <ReserveTray color="black" pieces={reserves.black} active={turn === "black" && !winner} selection={selection} onSelect={selectReserve} />
        <section className="board-wrap">
          <div className="capture-score capture-score-black"><span>♙</span> {captures.black}</div>
          <div className="board" role="grid" aria-label="4 by 4 chessboard">
            {board.map((piece, index) => {
              const selected = selection?.source === "board" && selection.index === index;
              const legal = legalTargets.includes(index);
              const capture = legal && !!piece && piece.color !== turn;
              return (
                <button
                  key={index}
                  role="gridcell"
                  className={`square square-${(row(index) + col(index)) % 2 ? "dark" : "light"}${selected ? " selected" : ""}${legal ? " legal" : ""}${capture ? " capture" : ""}`}
                  onClick={() => selectSquare(index)}
                  aria-label={`${String.fromCharCode(97 + col(index))}${4 - row(index)}${piece ? `, ${piece.color} ${NAMES[piece.type]}` : ", empty"}`}
                >
                  {piece && <PieceGlyph piece={piece} />}
                  {legal && !piece && <span className="move-dot" />}
                </button>
              );
            })}
          </div>
          <div className="capture-score capture-score-white"><span>♟</span> {captures.white}</div>
        </section>
        <ReserveTray color="white" pieces={reserves.white} active={turn === "white" && !winner} selection={selection} onSelect={selectReserve} />
      </div>

      <footer className="game-footer">
        <p>{lastAction}</p>
        <div>
          <button className="text-button" onClick={() => setScreen("rules")}>RULES</button>
          <button className="text-button" onClick={resetGame}>RESTART</button>
        </div>
      </footer>

      {winner && (
        <div className="winner-overlay" role="dialog" aria-modal="true">
          <div className="confetti" aria-hidden="true">
            {Array.from({ length: 24 }, (_, index) => <i key={index} style={{ "--i": index } as React.CSSProperties} />)}
          </div>
          <section className="winner-card">
            <span className={`winner-piece winner-${winner}`}>{winner === "white" ? "♕" : "♛"}</span>
            <p>LAST MAN STANDING</p>
            <h2>{winner === "white" ? "PLAYER 1" : "PLAYER 2"} WINS!</h2>
            <button className="primary-button" onClick={resetGame}>PLAY AGAIN</button>
            <button className="text-button" onClick={() => setScreen("home")}>BACK HOME</button>
          </section>
        </div>
      )}
    </main>
  );
}
