"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ChessState,
  Color,
  GLYPHS,
  NAMES,
  otherColor,
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
import { QUICK_MESSAGES, useUsionGame } from "./useUsionGame";

type Screen = "home" | "rules" | "game";
type Selection =
  | { source: "board"; index: number }
  | { source: "reserve"; color: Color; id: string; type: PieceType }
  | null;

const RULES = [
  {
    title: "PUT PIECES INSIDE THE MAIN BOARD",
    copy: "Each player has a five-minute clock. Only your clock runs on your turn, and reaching 0:00 loses the match. Drop one piece from your tray or move one already in play; a pawn cannot be dropped onto its promotion rank.",
    art: "deploy",
  },
  {
    title: "MOVE & CAPTURE LIKE CHESS",
    copy: "Every piece moves by standard chess rules. There is no king on the board, so there is no check and no checkmate — every piece can simply be taken.",
    art: "capture",
  },
  {
    title: "PROMOTE & BE THE LAST STANDING",
    copy: "Walk a pawn to the far rank and it becomes a Queen. Wipe out the whole rival army, tray included, to win.",
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

const squareName = (index: number) =>
  `${String.fromCharCode(65 + col(index))}${4 - row(index)}`;

function lastMoveText(state: ChessState) {
  const move = state.lastMove;
  if (!move) return "No moves yet";
  if (move.kind === "timeout") return `${move.color.toUpperCase()} · TIME EXPIRED`;
  if (move.kind === "deploy" && move.to !== null) {
    return `${move.color.toUpperCase()} · DEPLOY → ${squareName(move.to)}`;
  }
  if (move.from !== null && move.to !== null) {
    return `${move.color.toUpperCase()} · ${squareName(move.from)} → ${squareName(move.to)}`;
  }
  return state.lastAction;
}

function formatClock(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1_000));
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

const TRAY_ROW = RESERVE_ORDER.length / 2;

// Pawns line up in front of the back rank, as on a real board. "Front" is the
// row nearest the board, so the two trays mirror each other: your pawns sit on
// the tray's top row, the opponent's on their bottom row. Each row keeps its
// own seven slots so deploying from one never reflows the other.
function traySlots(pieces: Piece[], pawnsFirst: boolean): Array<Piece | null> {
  const pawns = pieces.filter((piece) => piece.type === "pawn");
  const others = pieces.filter((piece) => piece.type !== "pawn");
  const [first, second] = pawnsFirst ? [pawns, others] : [others, pawns];
  return [
    ...Array.from({ length: TRAY_ROW }, (_, index) => first[index] ?? null),
    ...Array.from({ length: TRAY_ROW }, (_, index) => second[index] ?? null),
  ];
}

function ReserveTray({
  color,
  label,
  pieces,
  pawnsFirst,
  active,
  clockMs,
  clockPosition,
  clockRunning,
  selection,
  onSelect,
}: {
  color: Color;
  label: string;
  pieces: Piece[];
  pawnsFirst: boolean;
  active: boolean;
  clockMs: number;
  clockPosition: "above" | "below";
  clockRunning: boolean;
  selection: Selection;
  onSelect: (piece: Piece) => void;
}) {
  const clock = (
    <div
      className={`player-clock clock-${clockPosition}${clockRunning ? " clock-running" : ""}${clockMs <= 30_000 ? " clock-danger" : ""}`}
      aria-label={`${label} clock ${formatClock(clockMs)}`}
    >
      <span>{label}</span>
      <strong>{formatClock(clockMs)}</strong>
    </div>
  );

  return (
    <section className={`reserve reserve-${color}${active ? " reserve-active" : ""}`} aria-label={`${color} reserve`}>
      {clockPosition === "above" && clock}
      <div className="reserve-label">
        <span>{label}</span>
        <strong>{pieces.length} PCS</strong>
      </div>
      <div className="reserve-grid">
        {traySlots(pieces, pawnsFirst).map((piece, index) => {
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
      {clockPosition === "below" && clock}
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
  const [chatOpen, setChatOpen] = useState(false);
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
              <span key={index}>{index === 2 ? GLYPHS.queen : index === 13 ? GLYPHS.pawn : ""}</span>
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
                        {filled ? (seat === 0 ? GLYPHS.rook : GLYPHS.queen) : "?"}
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
              <span key={index}>{index === 2 ? GLYPHS.queen : index === 13 ? GLYPHS.pawn : ""}</span>
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

  // Each player looks at the board from their own side: your army sits on the
  // bottom rank and your tray under it, exactly as it does for the other
  // player on their phone. Black therefore views the board rotated 180°.
  const seatColor: Color = usion.userColor ?? "white";
  const flipped = seatColor === "black";
  const viewIndex = (slot: number) => (flipped ? 15 - slot : slot);
  const topColor = otherColor(seatColor);
  const seated = Boolean(usion.userColor);
  const clocks = usion.active ? usion.remainingByColor : state.clocks;
  const lastMoveByOpponent = Boolean(
    state.lastMove &&
    usion.userColor &&
    state.lastMove.color !== usion.userColor,
  );

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
          <span className="turn-copy">
            {winner ? `${winner === "white" ? "WHITE" : "BLACK"} WINS` : usion.active ? `${myLabel} · ${turn.toUpperCase()}'S TURN` : myLabel}
          </span>
        </div>
        <button className="icon-button" onClick={() => setSoundOn((value) => !value)} aria-label={soundOn ? "Mute sound" : "Turn sound on"}>
          {soundOn ? "♪" : "×"}
        </button>
      </header>

      {usion.quickMessage && (
        <div
          className={`quick-message-toast message-${usion.quickMessage.from}`}
          key={usion.quickMessage.nonce}
          role="status"
          aria-live="polite"
        >
          <small>{usion.quickMessage.from === "you" ? "YOU" : "OPPONENT"}</small>
          <strong>{usion.quickMessage.text}</strong>
        </div>
      )}

      <div className="game-stage">
        <ReserveTray
          color={topColor}
          label={seated ? "OPPONENT" : topColor === "white" ? "PLAYER 1" : "PLAYER 2"}
          pieces={reserves[topColor]}
          pawnsFirst={false}
          active={turn === topColor && canInteract}
          clockMs={clocks[topColor]}
          clockPosition="above"
          clockRunning={!winner && turn === topColor && state.turnStartedAt !== null}
          selection={selection}
          onSelect={selectReserve}
        />
        <section className="board-wrap">
          <div className="capture-score capture-score-black"><span>{GLYPHS.pawn}</span> {captures[topColor]}</div>
          <div className="board" role="grid" aria-label="4 by 4 chessboard">
            {Array.from({ length: 16 }, (_, slot) => {
              const index = viewIndex(slot);
              const piece = board[index];
              const selected = selection?.source === "board" && selection.index === index;
              const legal = legalTargets.includes(index);
              const capture = legal && !!piece && piece.color !== turn;
              const lastFrom = state.lastMove?.from === index;
              const lastTo = state.lastMove?.to === index;
              return (
                <button
                  key={index}
                  role="gridcell"
                  className={`square square-${(row(index) + col(index)) % 2 ? "dark" : "light"}${selected ? " selected" : ""}${legal ? " legal" : ""}${capture ? " capture" : ""}${lastFrom ? " last-from" : ""}${lastTo ? " last-to" : ""}${lastMoveByOpponent && (lastFrom || lastTo) ? " opponent-last" : ""}`}
                  onClick={() => selectSquare(index)}
                  aria-label={`${String.fromCharCode(97 + col(index))}${4 - row(index)}${piece ? `, ${piece.color} ${NAMES[piece.type]}` : ", empty"}`}
                >
                  {piece && <PieceGlyph piece={piece} />}
                  {legal && !piece && <span className="move-dot" />}
                </button>
              );
            })}
          </div>
          <div className="capture-score capture-score-white"><span>{GLYPHS.pawn}</span> {captures[seatColor]}</div>
        </section>
        <ReserveTray
          color={seatColor}
          label={seated ? "YOU" : seatColor === "white" ? "PLAYER 1" : "PLAYER 2"}
          pieces={reserves[seatColor]}
          pawnsFirst
          active={turn === seatColor && canInteract}
          clockMs={clocks[seatColor]}
          clockPosition="below"
          clockRunning={!winner && turn === seatColor && state.turnStartedAt !== null}
          selection={selection}
          onSelect={selectReserve}
        />
      </div>

      <footer className="game-footer">
        <div className="move-summary" aria-live="polite">
          <small>{usion.pending ? "SENDING MOVE…" : "LAST MOVE"}</small>
          <strong>{usion.pending ? state.lastAction : lastMoveText(state)}</strong>
        </div>
        <div className="footer-actions">
          {usion.active && (
            <button
              className="text-button message-button"
              onClick={() => setChatOpen((open) => !open)}
              aria-expanded={chatOpen}
              aria-controls="quick-message-panel"
            >
              MESSAGE
            </button>
          )}
          <button className="text-button" onClick={() => setScreen("rules")}>RULES</button>
          {!usion.active && <button className="text-button" onClick={resetGame}>RESTART</button>}
        </div>
      </footer>

      {usion.active && chatOpen && (
        <aside
          className="quick-message-panel"
          id="quick-message-panel"
          aria-label="Quick messages"
        >
          <div className="quick-message-heading">
            <strong>SEND A QUICK MESSAGE</strong>
            <button onClick={() => setChatOpen(false)} aria-label="Close messages">×</button>
          </div>
          <div className="quick-message-list">
            {QUICK_MESSAGES.map((message) => (
              <button
                className="quick-message-chip"
                key={message.id}
                onClick={() => {
                  setChatOpen(false);
                  void usion.sendQuickMessage(message.id);
                }}
              >
                {message.text}
              </button>
            ))}
          </div>
        </aside>
      )}

      {winner && (
        <div className="winner-overlay" role="dialog" aria-modal="true">
          <div className="confetti" aria-hidden="true">
            {Array.from({ length: 24 }, (_, index) => <i key={index} style={{ "--i": index } as React.CSSProperties} />)}
          </div>
          <section className="winner-card">
            <span className={`winner-piece winner-${winner}`}>{GLYPHS.queen}</span>
            <p>{state.lastMove?.kind === "timeout" ? "TIME EXPIRED" : "LAST MAN STANDING"}</p>
            <h2>{winner === "white" ? "WHITE" : "BLACK"} WINS!</h2>
            <button className="primary-button" onClick={resetGame}>REMATCH</button>
            <button className="text-button" onClick={() => setScreen("home")}>BACK HOME</button>
          </section>
        </div>
      )}
    </main>
  );
}
