import { byField, nodesOf, sum, type Of, type Reader } from "./graph.js";

export interface Spend {
  readonly runs: readonly Of<"run">[];
  readonly total: number;
  readonly running: number;
  readonly byVendor: readonly { vendor: string; runs: number; tokens: number }[];
  readonly byOutcome: readonly { status: string; runs: number; tokens: number }[];
  readonly costliest: readonly Of<"run">[];
  /** Tokens spent in the last seven days. */
  readonly week: number;
}

export function spend(store: Reader, costliest = 10): Spend {
  const runs = nodesOf(store, "run");
  const weekAgo = Date.now() - 7 * 86_400_000;
  const tokens = (r: Of<"run">) => r.tokens;
  const group = (of: (r: Of<"run">) => string | undefined) =>
    [...byField(runs, of).entries()]
      .map(([key, members]) => ({ key, runs: members.length, tokens: sum(members, tokens) }))
      .sort((a, b) => b.tokens - a.tokens);
  return {
    runs,
    total: sum(runs, tokens),
    running: runs.filter((r) => r.status === "running").length,
    byVendor: group((r) => r.vendor).map(({ key, ...rest }) => ({ vendor: key, ...rest })),
    byOutcome: group((r) => r.status).map(({ key, ...rest }) => ({ status: key, ...rest })),
    costliest: [...runs].sort((a, b) => (b.tokens ?? 0) - (a.tokens ?? 0)).slice(0, costliest),
    week: sum(
      runs.filter((r) => r.startedAt !== undefined && new Date(r.startedAt).getTime() >= weekAgo),
      tokens,
    ),
  };
}
