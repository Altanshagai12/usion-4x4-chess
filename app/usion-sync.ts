import type { ChessState } from "./chess-engine";

export type OptimisticTarget = {
  key: string;
  moveCount: number;
  actionType: string;
};

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
