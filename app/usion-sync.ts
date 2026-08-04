import type { ChessState } from "./chess-engine";

export type OptimisticTarget = {
  key: string;
  moveCount: number;
  actionType: string;
};

function sequenceNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : 0;
}

// `join()` can return an old, already-resolved promise after the mini app is
// reopened in the same WebView. The SDK's live sequence is therefore the
// authoritative fallback when deciding whether this is a fresh room or a
// room whose checkpoint/history must be requested again.
export function roomRecoverySequence(
  joinedSequence: unknown,
  sdkSequence: unknown,
): number {
  return Math.max(sequenceNumber(joinedSequence), sequenceNumber(sdkSequence));
}

// A shared echo may be skipped while a later opponent action still arrives.
// In that case the later move is authoritative and must replace the local
// optimistic board; otherwise the player remains stuck one turn behind.
export function sharedStateReplacesOptimistic(
  next: ChessState,
  nextKey: string,
  target: OptimisticTarget | null,
): boolean {
  if (!target || nextKey === target.key) return true;
  if (target.actionType === "reset") return next.winner === null;
  return next.moveCount > target.moveCount;
}
