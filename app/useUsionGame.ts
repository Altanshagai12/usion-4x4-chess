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

export const QUICK_MESSAGES = [
  { id: "hurry", text: "Хурдлаарай ⏱️" },
  { id: "nice_move", text: "Гоё нүүдэл! 👏" },
  { id: "ready", text: "Би бэлэн байна" },
  { id: "good_luck", text: "Амжилт! 🍀" },
  { id: "rematch", text: "Дахин тоглох уу?" },
] as const;

type QuickMessage = {
  id: string;
  text: string;
  from: "you" | "opponent";
  nonce: number;
};

const findQuickMessage = (id: unknown) =>
  QUICK_MESSAGES.find((message) => message.id === id);

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

type RealtimeEvent = {
  player_id?: string;
  action_type?: string;
  action_data?: Record<string, unknown>;
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
  realtime(
    type: string,
    data?: Record<string, unknown>,
  ): void | Promise<void>;
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
  onRealtime(handler: (event: RealtimeEvent) => void): (() => void) | void;
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

function compatibleState(state: ChessState): ChessState {
  return state?.schemaVersion === 7 ? state : createInitialChessState();
}

export function useUsionGame() {
  const [state, setState] = useState<ChessState>(() => createInitialChessState());
  const [optimisticState, setOptimisticState] = useState<ChessState | null>(null);
  const [active, setActive] = useState(false);
  const [embedded, setEmbedded] = useState(false);
  const [started, setStarted] = useState(false);
  const [connection, setConnection] = useState<Connection>("standalone");
  const [playerIds, setPlayerIds] = useState<string[]>([]);
  const [userId, setUserId] = useState("");
  const [pending, setPending] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [error, setError] = useState("");
  const [quickMessage, setQuickMessage] = useState<QuickMessage | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [localTurnStartedAt, setLocalTurnStartedAt] = useState(0);
  const [roomClockActive, setRoomClockActive] = useState(false);
  const sharedRef = useRef<SharedState | null>(null);
  const playerIdsRef = useRef<string[]>([]);
  const inviteRef = useRef<(() => Promise<boolean>) | null>(null);
  const quickMessageTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const quickMessageCooldownRef = useRef(0);
  const startingClockRef = useRef(false);
  const timeoutTurnRef = useRef("");
  const optimisticStateKeyRef = useRef<string | null>(null);
  const turnAnchorKeyRef = useRef("");
  const readyClockStartedRef = useRef(false);

  const stateKey = useCallback(
    (next: ChessState) =>
      `${next.schemaVersion}:${next.moveCount}:${next.turn}:${next.clockRunning}`,
    [],
  );

  const acceptSharedState = useCallback(
    (incoming: ChessState) => {
      const next = compatibleState(incoming);
      const key = stateKey(next);
      const optimisticKey = optimisticStateKeyRef.current;
      if (optimisticKey && key !== optimisticKey) {
        setState(next);
        return;
      }
      if (turnAnchorKeyRef.current !== key) {
        turnAnchorKeyRef.current = key;
        setLocalTurnStartedAt(Date.now());
      }
      setState(next);
      if (optimisticKey === key) {
        optimisticStateKeyRef.current = null;
        setOptimisticState(null);
      }
    },
    [stateKey],
  );

  const showQuickMessage = useCallback(
    (message: (typeof QUICK_MESSAGES)[number], from: QuickMessage["from"]) => {
      if (quickMessageTimerRef.current) {
        clearTimeout(quickMessageTimerRef.current);
      }
      setQuickMessage({
        id: message.id,
        text: message.text,
        from,
        nonce: Date.now(),
      });
      quickMessageTimerRef.current = setTimeout(
        () => setQuickMessage(null),
        3_200,
      );
    },
    [],
  );

  useEffect(
    () => () => {
      if (quickMessageTimerRef.current) {
        clearTimeout(quickMessageTimerRef.current);
      }
    },
    [],
  );

  // Both seats filled means the match is live. `started` latches on so a later
  // blip shows a reconnect notice rather than throwing players back to the
  // lobby mid-game.
  const applySeatState = useCallback((ids: string[]) => {
    const ready = ids.length >= 2;
    setConnection(ready ? "ready" : "waiting");
    setRoomClockActive(ready);
    if (ready) {
      setStarted(true);
      if (!readyClockStartedRef.current) {
        const startedAt = Date.now();
        readyClockStartedRef.current = true;
        turnAnchorKeyRef.current = `room-ready:${startedAt}`;
        setLocalTurnStartedAt(startedAt);
        setNow(startedAt);
      }
    } else {
      readyClockStartedRef.current = false;
    }
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
        addCleanup(
          cleanups,
          shared.onChange(acceptSharedState),
        );
        acceptSharedState(shared.get());

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
        addCleanup(cleanups, usion.game.onRealtime((event) => {
          if (
            event.action_type !== "quick_message" ||
            event.player_id === currentUserId
          ) {
            return;
          }
          const message = findQuickMessage(event.action_data?.id);
          if (message) showQuickMessage(message, "opponent");
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
          if (event.state) acceptSharedState(event.state);
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
  }, [acceptSharedState, applySeatState, showQuickMessage, updateRoster]);

  const seatIndex = playerIds.indexOf(userId);
  const userColor: Color | null =
    seatIndex === 0 ? "white" : seatIndex === 1 ? "black" : null;
  const canAct = connection === "ready" && userColor === state.turn && !pending;
  const sharedClockActive = state.clockRunning || roomClockActive;

  const commit = useCallback(
    async (
      type: "deploy" | "move" | "reset" | "timeout",
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
      const actionTime = Date.now();
      const previousAnchorKey = turnAnchorKeyRef.current;
      const previousLocalTurnStartedAt = localTurnStartedAt;
      const elapsedMs = sharedClockActive
        ? Math.max(0, actionTime - localTurnStartedAt)
        : 0;
      const actionData = { ...data, elapsedMs };
      const preview = reduceChess(state, {
        type,
        data: { ...actionData, color: userColor },
      });
      if (preview !== state) {
        optimisticStateKeyRef.current = stateKey(preview);
        turnAnchorKeyRef.current = stateKey(preview);
        setLocalTurnStartedAt(actionTime);
        setOptimisticState(preview);
        setNow(actionTime);
      }
      try {
        await shared.commit(type, actionData, {
          nextTurn,
          queueOffline: true,
        });
        return true;
      } catch (reason) {
        optimisticStateKeyRef.current = null;
        turnAnchorKeyRef.current = previousAnchorKey;
        setLocalTurnStartedAt(previousLocalTurnStartedAt);
        setOptimisticState(null);
        setError(
          reason instanceof Error ? reason.message : "Move was not sent",
        );
        return false;
      } finally {
        setPending(false);
      }
    },
    [
      canAct,
      localTurnStartedAt,
      playerIds,
      sharedClockActive,
      state,
      stateKey,
      userColor,
    ],
  );

  useEffect(() => {
    if (
      !active ||
      connection !== "ready" ||
      playerIds.length < 2 ||
      playerIds[0] !== userId ||
      state.winner ||
      state.clockRunning ||
      startingClockRef.current
    ) {
      return;
    }

    const shared = sharedRef.current;
    if (!shared) return;
    startingClockRef.current = true;
    void shared
      .commit(
        "start",
        {},
        { nextTurn: playerIds[0], queueOffline: true },
      )
      .catch((reason) => {
        startingClockRef.current = false;
        setError(
          reason instanceof Error ? reason.message : "Clock did not start",
        );
      });
  }, [
    active,
    connection,
    playerIds,
    state.clockRunning,
    state.winner,
    userId,
  ]);

  const displayState = optimisticState ?? state;
  const clockLive = displayState.clockRunning || roomClockActive;

  useEffect(() => {
    if (state.clockRunning) startingClockRef.current = false;
    if (
      !active ||
      connection !== "ready" ||
      displayState.winner ||
      !clockLive
    ) {
      return;
    }
    const frame = requestAnimationFrame(() => setNow(Date.now()));
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => {
      cancelAnimationFrame(frame);
      clearInterval(timer);
    };
  }, [
    active,
    connection,
    displayState.winner,
    clockLive,
    state.clockRunning,
  ]);

  const activeElapsed =
    !clockLive
      ? 0
      : Math.max(0, now - localTurnStartedAt);
  const activeRemainingMs = Math.max(
    0,
    displayState.clocks[displayState.turn] - activeElapsed,
  );
  const remainingByColor: Record<Color, number> = {
    ...displayState.clocks,
    [displayState.turn]: activeRemainingMs,
  };

  useEffect(() => {
    if (
      !active ||
      connection !== "ready" ||
      displayState.winner ||
      !clockLive ||
      activeRemainingMs > 0 ||
      !canAct
    ) {
      return;
    }

    const turnKey = `${displayState.moveCount}:${displayState.turn}`;
    if (timeoutTurnRef.current === turnKey) return;
    timeoutTurnRef.current = turnKey;
    void commit("timeout", {}).then((sent) => {
      if (!sent) timeoutTurnRef.current = "";
    });
  }, [
    active,
    canAct,
    commit,
    connection,
    activeRemainingMs,
    displayState.moveCount,
    displayState.turn,
    displayState.winner,
    clockLive,
  ]);

  const sendQuickMessage = useCallback(
    async (id: string) => {
      const message = findQuickMessage(id);
      const usion = window.Usion;
      if (
        !message ||
        !usion ||
        !active ||
        connection !== "ready" ||
        Date.now() < quickMessageCooldownRef.current
      ) {
        return false;
      }

      quickMessageCooldownRef.current = Date.now() + 1_500;
      try {
        await Promise.resolve(
          usion.game.realtime("quick_message", { id: message.id }),
        );
        showQuickMessage(message, "you");
        return true;
      } catch (reason) {
        setError(
          reason instanceof Error ? reason.message : "Message was not sent",
        );
        return false;
      }
    },
    [active, connection, showQuickMessage],
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
    state: displayState,
    connection,
    playerIds,
    userColor,
    canAct,
    pending,
    inviting,
    error,
    clockRunning: clockLive,
    remainingByColor,
    quickMessage,
    commit,
    sendQuickMessage,
    invite,
    recover,
    opponentColor: userColor ? otherColor(userColor) : null,
  };
}
