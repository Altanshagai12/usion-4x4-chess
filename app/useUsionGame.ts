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
  | "lobby"
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

type InviteResult = {
  sent?: boolean;
  roomId?: string | null;
  invited?: string[];
};

type UsionGame = {
  connect(): Promise<unknown>;
  join(roomId: string): Promise<unknown>;
  isMultiplayer(): boolean;
  // The platform owns the friend/group picker; the game never draws its own.
  invite(options?: Record<string, unknown>): Promise<InviteResult>;
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
  const [embedded, setEmbedded] = useState(false);
  const [started, setStarted] = useState(false);
  const [connection, setConnection] = useState<Connection>("standalone");
  const [playerIds, setPlayerIds] = useState<string[]>([]);
  const [userId, setUserId] = useState("");
  const [pending, setPending] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [error, setError] = useState("");
  const sharedRef = useRef<SharedState | null>(null);
  const playerIdsRef = useRef<string[]>([]);
  const inviteRef = useRef<(() => Promise<boolean>) | null>(null);

  // Both seats filled means the match is live. `started` latches on so a later
  // blip shows a reconnect notice rather than throwing players back to the
  // lobby mid-game.
  const applySeatState = useCallback((ids: string[]) => {
    const ready = ids.length >= 2;
    setConnection(ready ? "ready" : "waiting");
    if (ready) setStarted(true);
  }, []);

  const updateRoster = useCallback(
    (ids: string[] | undefined) => {
      if (!ids) return;
      const next = [...ids];
      playerIdsRef.current = next;
      setPlayerIds(next);
      applySeatState(next);
    },
    [applySeatState],
  );

  useEffect(() => {
    // The Usions mobile app runs mini-apps in a React Native WebView, where
    // `window.parent === window` — gating on iframe-ness alone skips SDK setup
    // on every phone and silently drops the game into the offline fallback.
    // The host bridge is what actually proves we are embedded.
    const hosted =
      Boolean((window as { ReactNativeWebView?: unknown }).ReactNativeWebView) ||
      window.parent !== window;
    if (!hosted) return;
    let cancelled = false;
    const cleanups: Array<() => void> = [];
    let attempts = 0;

    const boot = async () => {
      // Mark this as a hosted session up front. If the SDK is slow or never
      // loads, the UI must still refuse to offer offline hot-seat play here.
      setEmbedded(true);
      setConnection("connecting");
      while (!window.Usion && attempts < 40 && !cancelled) {
        attempts += 1;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      const usion = window.Usion;
      if (!usion || cancelled) {
        if (!cancelled) {
          setConnection("failed");
          setError("The Usions SDK did not load.");
        }
        return;
      }
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

        const enterRoom = async (roomId: string) => {
          try {
            await usion.game.connect();
            await usion.game.join(roomId);
            applySeatState(playerIdsRef.current);
          } catch (reason) {
            setError(
              reason instanceof Error ? reason.message : "Could not join the match",
            );
            setConnection("failed");
          }
        };
        inviteRef.current = async () => {
          setInviting(true);
          setError("");
          try {
            const result = await usion.game.invite();
            if (result?.roomId) {
              setActive(true);
              await enterRoom(result.roomId);
            }
            return Boolean(result?.sent);
          } catch (reason) {
            setError(
              reason instanceof Error ? reason.message : "Could not send the invite",
            );
            return false;
          } finally {
            setInviting(false);
          }
        };

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
        // A solo launch is promoted into a room by the host Share button or by
        // game.invite(). Joining here is what makes that promotion real —
        // without it the game would hold a room id it never entered.
        addCleanup(cleanups, usion.game.onRoomAssigned((event) => {
          setActive(true);
          setConnection("connecting");
          setError("");
          if (event.roomId) void enterRoom(event.roomId);
        }));
        addCleanup(cleanups, usion.game.onConnectionState((next) => {
          if (next === "disconnected" || next === "rejoining") {
            setConnection("recovering");
          } else {
            applySeatState(playerIdsRef.current);
          }
        }));
        addCleanup(cleanups, usion.game.onReconnected((event) => {
          if (event.state) setState(event.state);
          applySeatState(playerIdsRef.current);
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
          // Solo launch: idle in the lobby until an invite creates the room.
          setConnection("lobby");
          return;
        }

        const roomId = launch.roomId ?? config.roomId;
        if (!roomId) throw new Error("Usions did not assign a match room.");

        setActive(true);
        await enterRoom(roomId);
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
  }, [applySeatState, updateRoster]);

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

  const invite = useCallback(async () => {
    const run = inviteRef.current;
    if (!run) return false;
    return run();
  }, []);

  const recover = useCallback(() => {
    setConnection("recovering");
    setError("");
    window.Usion?.game.requestSync();
  }, []);

  return {
    active,
    embedded,
    started,
    state,
    connection,
    playerIds,
    userColor,
    canAct,
    pending,
    inviting,
    error,
    commit,
    invite,
    recover,
    opponentColor: userColor ? otherColor(userColor) : null,
  };
}
