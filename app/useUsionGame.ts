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
import {
  roomRecoverySequence,
  sharedStateReplacesOptimistic,
} from "./usion-sync";
import type { OptimisticTarget } from "./usion-sync";
import { parseUsionPlayerProfile } from "./usion-profile";
import type { UsionPlayerProfile } from "./usion-profile";
import {
  chessMatchId,
  saveChessRecord,
  type ChessRecordJob,
} from "./chess-records";

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

type RoomJoinResult = RosterEvent & {
  room_id?: string;
  sequence?: number;
};

type RealtimeEvent = {
  player_id?: string;
  action_type?: string;
  action_data?: Record<string, unknown>;
};

type UsionOwnProfile = {
  id?: string | null;
  name?: string | null;
  avatar?: string | null;
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
  onChange(
    handler: (state: ChessState, reason?: "action" | "recover") => void,
  ): (() => void) | void;
  getSequence(): number;
  destroy(): void;
};

type InviteResult = {
  sent?: boolean;
  roomId?: string | null;
  invited?: string[];
};

type UsionGame = {
  connect(): Promise<unknown>;
  join(roomId: string): Promise<RoomJoinResult>;
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
  requestSync(sequence?: number): void;
  getLastSequence(): number;
  reportResult(result: {
    winnerId: string;
    roomId: string;
    matchId: string;
  }): Promise<{ ok: boolean }>;
};

type UsionLeaderboard = {
  me(): Promise<{ score: number | null; metadata?: Record<string, unknown> }>;
  scores(userIds: string[]): Promise<Record<string, number | null>>;
  submit(
    score: number,
    metadata?: Record<string, unknown>,
  ): Promise<{ success: boolean; best: number }>;
};

type UsionGlobal = {
  version: string;
  init(options?: { timeout?: number }): Promise<UsionConfig>;
  getLaunchParams(): {
    roomId?: string;
    mode?: "single" | "multiplayer";
  };
  user: {
    getId(): string | null;
    getProfile(): Promise<UsionOwnProfile>;
  };
  game: UsionGame;
  leaderboard: UsionLeaderboard;
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
  const [opponentProfile, setOpponentProfile] =
    useState<UsionPlayerProfile | null>(null);
  const sharedRef = useRef<SharedState | null>(null);
  const playerIdsRef = useRef<string[]>([]);
  const inviteRef = useRef<(() => Promise<boolean>) | null>(null);
  const quickMessageTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const quickMessageCooldownRef = useRef(0);
  const startingClockRef = useRef(false);
  const timeoutTurnRef = useRef("");
  const optimisticTargetRef = useRef<OptimisticTarget | null>(null);
  const turnAnchorKeyRef = useRef("");
  const readyClockStartedRef = useRef(false);
  const activeRoomIdRef = useRef("");
  const hydratedRoomIdRef = useRef("");
  const joiningRoomIdRef = useRef("");
  const roomJoinPromiseRef = useRef<Promise<void> | null>(null);
  const settlingMatchRef = useRef("");
  const settledMatchRef = useRef("");
  const pendingRecordRef = useRef<ChessRecordJob | null>(null);
  const [recordStatus, setRecordStatus] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");

  const settleRecord = useCallback(async (job: ChessRecordJob) => {
    const matchId = chessMatchId(job.roomId, job.sequence);
    if (
      settledMatchRef.current === matchId ||
      settlingMatchRef.current === matchId
    ) {
      return;
    }
    settlingMatchRef.current = matchId;
    pendingRecordRef.current = job;
    setRecordStatus("saving");
    setError("");
    try {
      await saveChessRecord(job);
      settledMatchRef.current = matchId;
      pendingRecordRef.current = null;
      setRecordStatus("saved");
    } catch (reason) {
      setRecordStatus("error");
      setError(
        reason instanceof Error
          ? `Match finished, but the record was not saved: ${reason.message}`
          : "Match finished, but the record was not saved.",
      );
    } finally {
      if (settlingMatchRef.current === matchId) settlingMatchRef.current = "";
    }
  }, []);

  const stateKey = useCallback(
    (next: ChessState) =>
      `${next.schemaVersion}:${next.moveCount}:${next.turn}:${next.clockRunning}`,
    [],
  );

  // Both seats filled means the match is live, but only after the assigned
  // room's checkpoint/history has been restored. This prevents an initial
  // board from flashing as a new match while a rejoin sync is still pending.
  const applySeatState = useCallback((ids: string[]) => {
    const rosterReady = ids.length >= 2;
    const roomReady =
      rosterReady &&
      Boolean(activeRoomIdRef.current) &&
      hydratedRoomIdRef.current === activeRoomIdRef.current;
    setConnection(roomReady ? "ready" : rosterReady ? "recovering" : "waiting");
    setRoomClockActive(roomReady);
    if (roomReady) {
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

  const markRoomHydrated = useCallback(() => {
    const roomId = activeRoomIdRef.current;
    if (!roomId) return;
    hydratedRoomIdRef.current = roomId;
    applySeatState(playerIdsRef.current);
  }, [applySeatState]);

  const acceptSharedState = useCallback(
    (incoming: ChessState, reason?: "action" | "recover") => {
      const next = compatibleState(incoming);
      const key = stateKey(next);
      const optimisticTarget = optimisticTargetRef.current;
      const replacesOptimistic = sharedStateReplacesOptimistic(
        next,
        key,
        optimisticTarget,
      );
      if (optimisticTarget && !replacesOptimistic) {
        setState(next);
        return;
      }
      if (turnAnchorKeyRef.current !== key) {
        turnAnchorKeyRef.current = key;
        setLocalTurnStartedAt(Date.now());
      }
      setState(next);
      if (optimisticTarget && replacesOptimistic) {
        optimisticTargetRef.current = null;
        setOptimisticState(null);
      }
      // Only a checkpoint/history recovery proves that an existing room is
      // fully hydrated. A live action can arrive before that recovery and is
      // not sufficient by itself to reconstruct the board.
      if (reason === "recover") {
        markRoomHydrated();
      }
    },
    [markRoomHydrated, stateKey],
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

        const broadcastOwnProfile = async () => {
          if (!currentUserId) return;
          try {
            const profile = parseUsionPlayerProfile(
              await usion.user.getProfile(),
              currentUserId,
            );
            if (!profile) return;
            await Promise.resolve(
              usion.game.realtime("player_profile", {
                name: profile.displayName,
                avatar: profile.avatarUrl,
              }),
            );
          } catch {
            // Profile decoration never blocks room connection or gameplay.
          }
        };

        const requestOpponentProfile = async () => {
          try {
            await Promise.resolve(
              usion.game.realtime("player_profile_request", {}),
            );
          } catch {
            // The next roster/reconnect event retries the request.
          }
        };

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

        const enterRoom = (roomId: string): Promise<void> => {
          if (
            joiningRoomIdRef.current === roomId &&
            roomJoinPromiseRef.current
          ) {
            return roomJoinPromiseRef.current;
          }

          if (activeRoomIdRef.current !== roomId) {
            activeRoomIdRef.current = roomId;
            hydratedRoomIdRef.current = "";
            readyClockStartedRef.current = false;
            optimisticTargetRef.current = null;
            setOptimisticState(null);
            setStarted(false);
            setRoomClockActive(false);
            settlingMatchRef.current = "";
            settledMatchRef.current = "";
            pendingRecordRef.current = null;
            setRecordStatus("idle");
          }
          setActive(true);
          setConnection(
            playerIdsRef.current.length >= 2 ? "recovering" : "connecting",
          );
          setError("");

          joiningRoomIdRef.current = roomId;
          const joining = (async () => {
            try {
              await usion.game.connect();
              const joined = await usion.game.join(roomId);
              if (cancelled || activeRoomIdRef.current !== roomId) return;

              updateRoster(joined.player_ids ?? playerIdsRef.current);
              const sequence = roomRecoverySequence(
                joined.sequence,
                usion.game.getLastSequence(),
              );
              if (sequence > 0) {
                // Always start from zero on a fresh shared-state instance. The
                // SDK may reuse a resolved join promise whose original event
                // can no longer reach the newly registered state listener.
                setConnection("recovering");
                usion.game.requestSync(0);
              } else {
                markRoomHydrated();
              }
              applySeatState(playerIdsRef.current);
              await requestOpponentProfile();
            } catch (reason) {
              if (cancelled) return;
              setError(
                reason instanceof Error
                  ? reason.message
                  : "Could not join the match",
              );
              setConnection("failed");
            } finally {
              if (joiningRoomIdRef.current === roomId) {
                joiningRoomIdRef.current = "";
                roomJoinPromiseRef.current = null;
              }
            }
          })();
          roomJoinPromiseRef.current = joining;
          return joining;
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
          void requestOpponentProfile();
        }));
        addCleanup(cleanups, usion.game.onPlayerJoined((event) => {
          setActive(true);
          updateRoster(event.player_ids);
          void broadcastOwnProfile();
        }));
        addCleanup(cleanups, usion.game.onPlayerLeft((event) => {
          updateRoster(event.player_ids);
          setError("Your opponent left the match.");
        }));
        addCleanup(cleanups, usion.game.onRealtime((event) => {
          const senderId = event.player_id ?? "";
          if (!senderId || senderId === currentUserId) return;
          if (event.action_type === "player_profile_request") {
            void broadcastOwnProfile();
            return;
          }
          if (event.action_type === "player_profile") {
            const profile = parseUsionPlayerProfile(
              { id: senderId, ...event.action_data },
              senderId,
            );
            if (profile && playerIdsRef.current.includes(senderId)) {
              setOpponentProfile(profile);
            }
            return;
          }
          if (event.action_type === "quick_message") {
            const message = findQuickMessage(event.action_data?.id);
            if (message) showQuickMessage(message, "opponent");
          }
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
          if (event.state) acceptSharedState(event.state, "recover");
          else usion.game.requestSync(0);
          applySeatState(playerIdsRef.current);
          void requestOpponentProfile();
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
  }, [
    acceptSharedState,
    applySeatState,
    markRoomHydrated,
    showQuickMessage,
    updateRoster,
  ]);

  const seatIndex = playerIds.indexOf(userId);
  const userColor: Color | null =
    seatIndex === 0 ? "white" : seatIndex === 1 ? "black" : null;
  const canAct = connection === "ready" && userColor === state.turn && !pending;
  const sharedClockActive = state.clockRunning || roomClockActive;
  const opponentId = playerIds.find((id) => id && id !== userId) ?? "";

  const commit = useCallback(
    async (
      type: "deploy" | "move" | "reset" | "timeout",
      data: Record<string, unknown>,
    ) => {
      const shared = sharedRef.current;
      if (
        !shared ||
        !userColor ||
        (type === "reset" && playerIds[0] !== userId) ||
        (type !== "reset" && !canAct)
      ) return false;
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
        optimisticTargetRef.current = {
          key: stateKey(preview),
          moveCount: preview.moveCount,
          actionType: type,
        };
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
        optimisticTargetRef.current = null;
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
      userId,
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
    if (!state.winner) {
      if (!pendingRecordRef.current) setRecordStatus("idle");
      return;
    }
    if (
      !active ||
      connection !== "ready" ||
      playerIds.length < 2 ||
      !userId ||
      !userColor
    ) {
      return;
    }
    const shared = sharedRef.current;
    const roomId = activeRoomIdRef.current;
    if (!shared || !roomId) return;
    const sequence = shared.getSequence();
    if (sequence <= 0) return;
    const winnerId = state.winner === "white" ? playerIds[0] : playerIds[1];
    const opponentId = playerIds.find((id) => id && id !== userId);
    const usion = window.Usion;
    if (!usion || !winnerId || !opponentId) return;

    void settleRecord({
      leaderboard: usion.leaderboard,
      game: usion.game,
      roomId,
      sequence,
      userId,
      opponentId,
      winnerId,
      isHost: playerIds[0] === userId,
    });
  }, [
    active,
    connection,
    playerIds,
    settleRecord,
    state.winner,
    userColor,
    userId,
  ]);

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
    window.Usion?.game.requestSync(0);
  }, []);

  const retryRecord = useCallback(() => {
    const pending = pendingRecordRef.current;
    if (pending) void settleRecord(pending);
  }, [settleRecord]);

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
    opponentProfile:
      opponentProfile?.id === opponentId ? opponentProfile : null,
    commit,
    sendQuickMessage,
    invite,
    recover,
    opponentColor: userColor ? otherColor(userColor) : null,
    recordStatus,
    retryRecord,
    canRematch:
      !active || (playerIds[0] === userId && recordStatus === "saved"),
  };
}
