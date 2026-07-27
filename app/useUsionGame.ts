"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChessAction,
  ChessState,
  Color,
  createInitialChessState,
  otherColor,
  reduceChess,
} from "./chess-engine";

type Connection =
  | "standalone"
  | "connecting"
  | "waiting"
  | "ready"
  | "recovering"
  | "failed";

type UsionConfig = {
  userId?: string;
  roomId?: string;
  playerIds?: string[];
  mode?: "single" | "multiplayer";
};

type RosterEvent = {
  player_id?: string;
  player_ids?: string[];
};

type SyncedAction = {
  playerId?: string;
  type: string;
  data?: Record<string, unknown>;
  sequence?: number;
};

type SharedState = {
  get(): ChessState;
  commit(
    type: string,
    data?: Record<string, unknown>,
    options?: { nextTurn?: string; queueOffline?: boolean },
  ): Promise<{ success?: boolean; sequence?: number }>;
  onChange(handler: (state: ChessState) => void): (() => void) | void;
  destroy(): void;
};

type UsionGame = {
  connect(): Promise<unknown>;
  join(roomId: string): Promise<unknown>;
  isMultiplayer(): boolean;
  syncedState(
    initial: ChessState,
    options: {
      reduce: (state: ChessState, action: SyncedAction) => ChessState;
      checkpointEvery: number;
      authority: "host" | "all";
    },
  ): SharedState;
  onJoined(handler: (event: RosterEvent) => void): (() => void) | void;
  onPlayerJoined(handler: (event: RosterEvent) => void): (() => void) | void;
  onPlayerLeft(handler: (event: RosterEvent) => void): (() => void) | void;
  onRoomAssigned(
    handler: (event: { roomId: string }) => void,
  ): (() => void) | void;
  onConnectionState(
    handler: (
      state: "connected" | "disconnected" | "rejoining" | "reconnected",
    ) => void,
  ): (() => void) | void;
  onReconnected(
    handler: (event: { state?: ChessState }) => void,
  ): (() => void) | void;
  onError(
    handler: (event: { message?: string; code?: string }) => void,
  ): (() => void) | void;
  requestSync(): void;
};

type UsionGlobal = {
  version: string;
  init(options?: { timeout?: number }): Promise<UsionConfig>;
  getLaunchParams(): {
    roomId?: string;
    mode?: "single" | "multiplayer";
  };
  user: { getId(): string | null };
  game: UsionGame;
};

declare global {
  interface Window {
    Usion?: UsionGlobal;
  }
}

function addCleanup(
  cleanups: Array<() => void>,
  cleanup: (() => void) | void,
) {
  if (cleanup) cleanups.push(cleanup);
}

export function useUsionGame() {
  const [state, setState] = useState<ChessState>(() => createInitialChessState());
  const [active, setActive] = useState(false);
  const [connection, setConnection] = useState<Connection>("standalone");
  const [playerIds, setPlayerIds] = useState<string[]>([]);
  const [userId, setUserId] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const sharedRef = useRef<SharedState | null>(null);
  const playerIdsRef = useRef<string[]>([]);

  const updateRoster = useCallback((ids: string[] | undefined) => {
    if (!ids) return;
    const next = [...ids];
    playerIdsRef.current = next;
    setPlayerIds(next);
    setConnection(next.length >= 2 ? "ready" : "waiting");
  }, []);

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
      const usion = window.Usion;
      if (!usion || cancelled) return;

      setConnection("connecting");
      try {
        const config = await usion.init({ timeout: 8_000 });
        if (cancelled) return;

        const currentUserId = config.userId ?? usion.user.getId() ?? "";
        setUserId(currentUserId);
        updateRoster(config.playerIds ?? []);

        const shared = usion.game.syncedState(createInitialChessState(), {
          reduce: (current, action) => {
            const playerId = action.playerId ?? "";
            const seat = playerIdsRef.current.indexOf(playerId);
            const color: Color | null =
              seat === 0 ? "white" : seat === 1 ? "black" : null;
            const nextAction: ChessAction = {
              type: action.type,
              data: color ? { ...action.data, color } : action.data,
              playerId,
            };
            return reduceChess(current, nextAction);
          },
          checkpointEvery: 1,
          authority: "host",
        });
        sharedRef.current = shared;
        addCleanup(cleanups, shared.onChange((next) => setState(next)));
        setState(shared.get());

        addCleanup(cleanups, usion.game.onJoined((event) => {
          setActive(true);
          updateRoster(event.player_ids ?? playerIdsRef.current);
        }));
        addCleanup(cleanups, usion.game.onPlayerJoined((event) => {
          setActive(true);
          updateRoster(event.player_ids);
        }));
        addCleanup(cleanups, usion.game.onPlayerLeft((event) => {
          updateRoster(event.player_ids);
          setError("Your opponent left the match.");
        }));
        addCleanup(cleanups, usion.game.onRoomAssigned(() => {
          setActive(true);
          setConnection("connecting");
          setError("");
        }));
        addCleanup(cleanups, usion.game.onConnectionState((next) => {
          if (next === "disconnected" || next === "rejoining") {
            setConnection("recovering");
          } else {
            const ids = playerIdsRef.current;
            setConnection(ids.length >= 2 ? "ready" : "waiting");
          }
        }));
        addCleanup(cleanups, usion.game.onReconnected((event) => {
          if (event.state) setState(event.state);
          const ids = playerIdsRef.current;
          setConnection(ids.length >= 2 ? "ready" : "waiting");
        }));
        addCleanup(cleanups, usion.game.onError((event) => {
          setError(event.message ?? event.code ?? "Usions connection error");
        }));

        const launch = usion.getLaunchParams();
        const multiplayer =
          launch.mode === "multiplayer" ||
          config.mode === "multiplayer" ||
          usion.game.isMultiplayer();
        if (!multiplayer) {
          setConnection("standalone");
          return;
        }

        const roomId = launch.roomId ?? config.roomId;
        if (!roomId) throw new Error("Usions did not assign a match room.");

        setActive(true);
        await usion.game.connect();
        await usion.game.join(roomId);
        const ids = playerIdsRef.current;
        setConnection(ids.length >= 2 ? "ready" : "waiting");
      } catch (reason) {
        if (cancelled) return;
        setError(
          reason instanceof Error ? reason.message : "Could not join the match",
        );
        setConnection("failed");
      }
    };

    void boot();
    return () => {
      cancelled = true;
      cleanups.forEach((off) => off());
      sharedRef.current?.destroy();
      sharedRef.current = null;
    };
  }, [updateRoster]);

  const seatIndex = playerIds.indexOf(userId);
  const userColor: Color | null =
    seatIndex === 0 ? "white" : seatIndex === 1 ? "black" : null;
  const canAct = connection === "ready" && userColor === state.turn && !pending;

  const commit = useCallback(
    async (
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
        await shared.commit(type, data, {
          nextTurn,
          queueOffline: true,
        });
        return true;
      } catch (reason) {
        setError(
          reason instanceof Error ? reason.message : "Move was not sent",
        );
        return false;
      } finally {
        setPending(false);
      }
    },
    [canAct, playerIds, userColor],
  );

  const recover = useCallback(() => {
    setConnection("recovering");
    setError("");
    window.Usion?.game.requestSync();
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
