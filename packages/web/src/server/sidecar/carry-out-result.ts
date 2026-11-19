/**
 * One effect's result, as an approved sidecar call's tool result states it.
 *
 * Its own module because the card handlers that produce one (draft-file,
 * item-edit-card, …) are imported by broker.ts, which carry-out.ts imports:
 * reading the type from carry-out.ts closed an import cycle through the
 * broker. carry-out.ts re-exports it for its other callers.
 */
export interface CarryOutResult {
  ok: boolean;
  text: string;
  /** The PRD items the effect wrote, in order. */
  ids?: string[];
  /** True when rex recorded the effect without writing it: a hench run applies it after its test gate. Never set with `ok: false`. */
  held?: boolean;
  /** A started run's end, for an effect that outlives its tool result: a failed end revises the card. */
  ended?: Promise<CarryOutResult>;
}
