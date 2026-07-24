"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChessState,
  Color,
  createInitialChessState,
  otherColor,
  reduceChess,
} from "./chess-engine";

type Connection = "standalone" | "connecting" | "waiting" | "ready" | "recovering" | "failed";
type GameStatus = {
  connection: string;
  playerIds: string[];
  hostId?: string;
};
type SharedState = {
  get(): ChessState;
  commit(
    type: string,
    data: Record<string, unknown>,
    options?: Record<string, unknown>,
  ): Promise<{ sequence: number }>;
  onChange(handler: (state: ChessState) => void): () => void;
  destroy(): void;
};
type UsionApp = {
  context: { user: { id: string }; launch: { mode?: string } };
  game: {
    status: GameStatus;
    createState(
      initial: ChessState,
      reducer: typeof reduceChess,
      options: Record<string, unknown>,
    ): SharedState;
    join(options?: Record<string, unknown>): Promise<unknown>;
    recover(options?: Record<string, unknown>): Promise<unknown>;
    onStatus(handler: (status: GameStatus) => void): () => void;
  };
  destroy(reason?: string): Promise<void> | void;
};
type UsionGlobal = {
  version: string;
  init(options: { capabilities: string[] }): Promise<UsionApp>;
};

declare global {
  interface Window {
    Usion?: UsionGlobal;
  }
}

export function useUsionGame() {
  const [state, setState] = useState<ChessState>(() => createInitialChessState());
  const [connection, setConnection] = useState<Connection>("standalone");
  const [playerIds, setPlayerIds] = useState<string[]>([]);
  const [userId, setUserId] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const appRef = useRef<UsionApp | null>(null);
  const sharedRef = useRef<SharedState | null>(null);

  useEffect(() => {
    if (window.parent === window) return;
    let cancelled = false;
    const cleanups: Array<() => void> = [];
    let attempts = 0;

    const boot = async () => {
      while (!window.Usion && attempts < 40 && !cancelled) {
        attempts += 1;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      if (!window.Usion || cancelled) return;
      setConnection("connecting");
      try {
        const app = await window.Usion.init({ capabilities: ["game"] });
        if (cancelled) {
          void app.destroy("Game unmounted");
          return;
        }
        appRef.current = app;
        setUserId(app.context.user.id);
        if (app.context.launch.mode !== "multiplayer") {
          setConnection("standalone");
          return;
        }
        const shared = app.game.createState(
          createInitialChessState(),
          reduceChess,
          { checkpointEvery: 4, authority: "host" },
        );
        sharedRef.current = shared;
        cleanups.push(shared.onChange((next) => setState(next)));
        cleanups.push(app.game.onStatus((status) => {
          setPlayerIds([...status.playerIds]);
          if (status.connection === "recovering" || status.connection === "disconnected") {
            setConnection("recovering");
          } else if (status.connection === "failed") {
            setConnection("failed");
          } else if (status.connection === "ready") {
            setConnection(status.playerIds.length >= 2 ? "ready" : "waiting");
          }
        }));
        await app.game.join({ timeoutMs: 20_000 });
        setState(shared.get());
        const ids = [...app.game.status.playerIds];
        setPlayerIds(ids);
        setConnection(ids.length >= 2 ? "ready" : "waiting");
      } catch (reason) {
        if (cancelled) return;
        const message = reason instanceof Error ? reason.message : "Could not join the game";
        setError(message);
        setConnection("failed");
      }
    };

    void boot();
    return () => {
      cancelled = true;
      cleanups.forEach((off) => off());
      sharedRef.current?.destroy();
      void appRef.current?.destroy("Chess closed");
    };
  }, []);

  const active = connection !== "standalone";
  const seatIndex = playerIds.indexOf(userId);
  const userColor: Color | null =
    seatIndex === 0 ? "white" : seatIndex === 1 ? "black" : null;
  const canAct = connection === "ready" && userColor === state.turn && !pending;

  const commit = useCallback(async (
    type: "deploy" | "move" | "reset",
    data: Record<string, unknown>,
  ) => {
    const shared = sharedRef.current;
    if (!shared || !userColor || (type !== "reset" && !canAct)) return false;
    const opponentIndex = userColor === "white" ? 1 : 0;
    const opponentId = playerIds[opponentIndex];
    const nextTurn = type === "reset" ? playerIds[0] : opponentId;
    if (!nextTurn) return false;
    setPending(true);
    setError("");
    try {
      await shared.commit(type, { ...data, color: userColor }, {
        nextTurn,
        queueIfOffline: true,
        timeoutMs: 30_000,
      });
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Move was not sent");
      return false;
    } finally {
      setPending(false);
    }
  }, [canAct, playerIds, userColor]);

  const recover = useCallback(async () => {
    try {
      setConnection("recovering");
      await appRef.current?.game.recover({ timeoutMs: 20_000 });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not reconnect");
      setConnection("failed");
    }
  }, []);

  return {
    active,
    state,
    connection,
    playerIds,
    userColor,
    canAct,
    pending,
    error,
    commit,
    recover,
    opponentColor: userColor ? otherColor(userColor) : null,
  };
}
