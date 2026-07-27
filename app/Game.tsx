"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ChessState,
  Color,
  GLYPHS,
  NAMES,
  Piece,
  PieceType,
  RESERVE_ORDER,
  col,
  createInitialChessState,
  getDeployTargets,
  getMoves,
  reduceChess,
  row,
} from "./chess-engine";
import { useUsionGame } from "./useUsionGame";

type Screen = "home" | "rules" | "game";
type Selection =
  | { source: "board"; index: number }
  | { source: "reserve"; color: Color; id: string; type: PieceType }
  | null;

const RULES = [
  {
    title: "PUT PIECES INSIDE THE MAIN BOARD",
    copy: "On your turn, either drop one piece from your tray onto an empty square, or move a piece already in play. A pawn can never be dropped straight onto its promotion rank.",
    art: "deploy",
  },
  {
    title: "MOVE & CAPTURE LIKE CHESS",
    copy: "Every piece moves by standard chess rules. There is no check and no checkmate, so even a king can be captured like anything else.",
    art: "capture",
  },
  {
    title: "PROMOTE & BE THE LAST STANDING",
    copy: "Walk a pawn to the far rank and it becomes a Queen Pawn. Wipe out the whole rival army, tray included, to win.",
    art: "win",
  },
] as const;

function PieceGlyph({ piece, small = false }: { piece: Piece; small?: boolean }) {
  return (
    <span
      className={`piece-glyph piece-${piece.color}${small ? " piece-small" : ""}`}
      aria-hidden="true"
    >
      {GLYPHS[piece.type]}
    </span>
  );
}

function ReserveTray({
  color,
  pieces,
  active,
  selection,
  onSelect,
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
        {Array.from({ length: RESERVE_ORDER.length }, (_, index) => {
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

function ConnectionNotice({
  connection,
  playerCount,
  error,
  inviting,
  onInvite,
  recover,
}: {
  connection: string;
  playerCount: number;
  error: string;
  inviting: boolean;
  onInvite: () => void;
  recover: () => void;
}) {
  if (connection === "ready" || connection === "standalone") return null;
  const copy: Record<string, string> = {
    lobby: "Invite a friend to start the match.",
    connecting: "Connecting to Usions…",
    waiting: "Waiting for your opponent to join…",
    recovering: "Reconnecting and restoring the match…",
    failed: error || "The match connection needs attention.",
  };
  return (
    <div className={`connection-notice connection-${connection}`} role="status">
      <span className="connection-spinner" aria-hidden="true" />
      <div>
        <strong>{copy[connection] ?? "Preparing the match…"}</strong>
        {connection === "waiting" && <small>{playerCount} / 2 players connected</small>}
      </div>
      {(connection === "waiting" || connection === "lobby") && (
        <button onClick={onInvite} disabled={inviting}>
          {inviting ? "…" : "INVITE"}
        </button>
      )}
      {connection === "failed" && <button onClick={recover}>RETRY</button>}
    </div>
  );
}

export default function Game() {
  const usion = useUsionGame();
  const [screen, setScreen] = useState<Screen>("home");
  const [rulePage, setRulePage] = useState(0);
  const [localState, setLocalState] = useState<ChessState>(() => createInitialChessState());
  const [selection, setSelection] = useState<Selection>(null);
  const [soundOn, setSoundOn] = useState(true);
  const state = usion.active ? usion.state : localState;
  const { board, reserves, turn, winner, captures } = state;

  useEffect(() => {
    if (!usion.active) return;
    const frame = requestAnimationFrame(() => setScreen("game"));
    return () => cancelAnimationFrame(frame);
  }, [usion.active]);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setSelection(null));
    return () => cancelAnimationFrame(frame);
  }, [state.moveCount]);

  // Inside Usions every move must go through the room, so the board is live
  // only on your own turn. Offline hot-seat exists solely outside the host.
  const canInteract = !winner && (usion.embedded ? usion.canAct : true);
  const legalTargets = useMemo(() => {
    if (!selection || !canInteract) return [];
    if (selection.source === "reserve") {
      return getDeployTargets(board, selection.color, selection.type);
    }
    return getMoves(board, selection.index);
  }, [board, canInteract, selection]);

  const dispatch = async (
    type: "deploy" | "move" | "reset",
    data: Record<string, unknown>,
  ) => {
    if (usion.active) {
      await usion.commit(type, data);
      return;
    }
    setLocalState((current) =>
      reduceChess(current, { type, data: { ...data, color: current.turn } }),
    );
  };

  const resetGame = () => {
    setSelection(null);
    if (usion.active && winner) void dispatch("reset", {});
    else if (!usion.active) setLocalState(createInitialChessState());
    setScreen("game");
  };

  const selectReserve = (piece: Piece) => {
    if (!canInteract || piece.color !== turn) return;
    setSelection((current) =>
      current?.source === "reserve" && current.id === piece.id
        ? null
        : { source: "reserve", color: piece.color, id: piece.id, type: piece.type },
    );
  };

  const selectSquare = (index: number) => {
    if (!canInteract) return;
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
      setSelection(null);
      void dispatch("deploy", { pieceId: selection.id, index });
      return;
    }
    if (target?.color === turn) {
      setSelection({ source: "board", index });
      return;
    }
    if (!legalTargets.includes(index)) return;
    const from = selection.index;
    setSelection(null);
    void dispatch("move", { from, to: index });
  };

  // Inside Usions the match cannot begin until the second seat is filled, so
  // the lobby holds the screen until then rather than exposing a playable
  // board. Other platform games behave the same way.
  if (usion.embedded && !usion.started && screen !== "rules") {
    const seats = Math.max(usion.playerIds.length, 1);
    const inRoom = usion.active;
    return (
      <main className="game-shell lobby-screen">
        <section className="home-card">
          <div className="mini-board-logo" aria-hidden="true">
            {Array.from({ length: 16 }, (_, index) => (
              <span key={index}>{index === 2 ? GLYPHS.king : index === 13 ? GLYPHS.pawn : ""}</span>
            ))}
          </div>
          <p className="eyebrow">QUICK ONLINE DUEL</p>
          <h1><span>4×4 CHESS</span><strong>LAST MAN STAND</strong></h1>

          {usion.connection === "failed" ? (
            <>
              <p className="home-copy">{usion.error || "The match connection needs attention."}</p>
              <div className="home-actions">
                <button className="primary-button" onClick={usion.recover}>RETRY</button>
              </div>
            </>
          ) : (
            <>
              <div className="lobby-seats" aria-live="polite">
                {[0, 1].map((seat) => {
                  const filled = seat < usion.playerIds.length;
                  return (
                    <div className={`lobby-seat${filled ? " filled" : ""}`} key={seat}>
                      <span className="lobby-avatar" aria-hidden="true">
                        {filled ? (seat === 0 ? GLYPHS.king : GLYPHS.queen) : "?"}
                      </span>
                      <strong>{filled ? (seat === 0 ? "PLAYER 1" : "PLAYER 2") : "WAITING…"}</strong>
                    </div>
                  );
                })}
              </div>
              <p className="home-copy">
                {inRoom
                  ? `${seats} / 2 players in the room. The duel starts the moment your friend joins.`
                  : "Invite a friend, then wait here — you each play from your own phone."}
              </p>
              <div className="home-actions">
                <button className="primary-button" onClick={() => void usion.invite()} disabled={usion.inviting}>
                  <span aria-hidden="true">♟</span>{" "}
                  {usion.inviting ? "OPENING…" : inRoom ? "INVITE ANOTHER FRIEND" : "INVITE A FRIEND"}
                </button>
                <button className="secondary-button" onClick={() => setScreen("rules")}>HOW TO PLAY?</button>
              </div>
            </>
          )}
          {usion.error && usion.connection !== "failed" && <p className="home-error">{usion.error}</p>}
        </section>
      </main>
    );
  }

  if (screen === "home") {
    // The lobby above owns every hosted session that has not started, so this
    // screen is only reached mid-match or outside the Usions host entirely.
    const primary = usion.embedded
      ? { label: "RETURN TO MATCH", run: () => setScreen("game") }
      : { label: "PRACTICE ON THIS DEVICE", run: resetGame };

    return (
      <main className="game-shell home-screen">
        <section className="home-card">
          <div className="mini-board-logo" aria-hidden="true">
            {Array.from({ length: 16 }, (_, index) => (
              <span key={index}>{index === 2 ? "♛" : index === 13 ? "♟" : ""}</span>
            ))}
          </div>
          <p className="eyebrow">QUICK ONLINE DUEL</p>
          <h1><span>4×4 CHESS</span><strong>LAST MAN STAND</strong></h1>
          <p className="home-copy">
            {usion.embedded
              ? "Invite a friend in Usions and battle from two different phones."
              : "Open this game inside Usions to duel a friend from two phones."}
          </p>
          <div className="home-actions">
            <button className="primary-button" onClick={primary.run}>
              <span aria-hidden="true">♟</span> {primary.label}
            </button>
            <button className="secondary-button" onClick={() => setScreen("rules")}>HOW TO PLAY?</button>
          </div>
          {usion.error && <p className="home-error">{usion.error}</p>}
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
              {RESERVE_ORDER.slice(0, 7).map((type, index) => (
                <span key={`${type}-${index}`}>{GLYPHS[type]}</span>
              ))}
            </div>
            <div className="rules-board">
              {Array.from({ length: 16 }, (_, index) => (
                <span key={index}>
                  {rule.art === "capture" && index === 5 ? GLYPHS.pawn : ""}
                  {rule.art === "capture" && index === 10 ? GLYPHS.rook : ""}
                  {rule.art === "win" && index === 2 ? GLYPHS.queen : ""}
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
            <button className="icon-button" onClick={() => rulePage === 0 ? setScreen(usion.active ? "game" : "home") : setRulePage((page) => page - 1)} aria-label="Previous">←</button>
            <button className="primary-button rules-next" onClick={() => {
              if (rulePage === RULES.length - 1) setScreen(usion.active || !usion.embedded ? "game" : "home");
              else setRulePage((page) => page + 1);
            }}>{rulePage === RULES.length - 1 ? "BACK TO GAME" : "NEXT"} →</button>
          </div>
        </section>
      </main>
    );
  }

  const myLabel = usion.active && usion.userColor
    ? `YOU ARE ${usion.userColor.toUpperCase()}`
    : `${turn === "white" ? "PLAYER 1" : "PLAYER 2"}'S TURN`;

  return (
    <main className="game-shell play-screen">
      <ConnectionNotice
        connection={usion.connection}
        playerCount={usion.playerIds.length}
        error={usion.error}
        inviting={usion.inviting}
        onInvite={() => void usion.invite()}
        recover={usion.recover}
      />
      <header className="game-header">
        <button className="icon-button" onClick={() => setScreen("home")} aria-label="Home">⌂</button>
        <div className="turn-pill" aria-live="polite">
          <span className={`turn-dot turn-${turn}`} />
          {winner ? `${winner === "white" ? "WHITE" : "BLACK"} WINS` : usion.active ? `${myLabel} · ${turn.toUpperCase()}'S TURN` : myLabel}
        </div>
        <button className="icon-button" onClick={() => setSoundOn((value) => !value)} aria-label={soundOn ? "Mute sound" : "Turn sound on"}>
          {soundOn ? "♪" : "×"}
        </button>
      </header>

      <div className="game-stage">
        <ReserveTray color="black" pieces={reserves.black} active={turn === "black" && canInteract} selection={selection} onSelect={selectReserve} />
        <section className="board-wrap">
          <div className="capture-score capture-score-black"><span>{GLYPHS.pawn}</span> {captures.black}</div>
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
          <div className="capture-score capture-score-white"><span>{GLYPHS.pawn}</span> {captures.white}</div>
        </section>
        <ReserveTray color="white" pieces={reserves.white} active={turn === "white" && canInteract} selection={selection} onSelect={selectReserve} />
      </div>

      <footer className="game-footer">
        <p>{usion.pending ? "Sending move…" : state.lastAction}</p>
        <div>
          <button className="text-button" onClick={() => setScreen("rules")}>RULES</button>
          {!usion.active && <button className="text-button" onClick={resetGame}>RESTART</button>}
        </div>
      </footer>

      {winner && (
        <div className="winner-overlay" role="dialog" aria-modal="true">
          <div className="confetti" aria-hidden="true">
            {Array.from({ length: 24 }, (_, index) => <i key={index} style={{ "--i": index } as React.CSSProperties} />)}
          </div>
          <section className="winner-card">
            <span className={`winner-piece winner-${winner}`}>{GLYPHS.queen}</span>
            <p>LAST MAN STANDING</p>
            <h2>{winner === "white" ? "WHITE" : "BLACK"} WINS!</h2>
            <button className="primary-button" onClick={resetGame}>REMATCH</button>
            <button className="text-button" onClick={() => setScreen("home")}>BACK HOME</button>
          </section>
        </div>
      )}
    </main>
  );
}
