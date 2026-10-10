import { byField, nodesOf, sum, type Node, type Reader } from "./graph.js";

export interface Spend {
  readonly runs: readonly Node[];
  readonly total: number;
  readonly running: number;
  readonly byVendor: readonly { vendor: string; runs: number; tokens: number }[];
  readonly byOutcome: readonly { status: string; runs: number; tokens: number }[];
  readonly costliest: readonly Node[];
  /** Tokens spent in the last seven days. */
  readonly week: number;
}

export function spend(store: Reader, costliest = 10): Spend {
  const runs = nodesOf(store, "run");
  const weekAgo = Date.now() - 7 * 86_400_000;
  const group = (field: string) =>
    [...byField<string>(runs, field).entries()]
      .map(([key, members]) => ({ key, runs: members.length, tokens: sum(members, "tokens") }))
      .sort((a, b) => b.tokens - a.tokens);
  return {
    runs,
    total: sum(runs, "tokens"),
    running: runs.filter((r) => r.status === "running").length,
    byVendor: group("vendor").map(({ key, ...rest }) => ({ vendor: key, ...rest })),
    byOutcome: group("status").map(({ key, ...rest }) => ({ status: key, ...rest })),
    costliest: [...runs].sort((a, b) => (Number(b.tokens) || 0) - (Number(a.tokens) || 0)).slice(0, costliest),
    week: sum(
      runs.filter((r) => typeof r.startedAt === "string" && new Date(r.startedAt).getTime() >= weekAgo),
      "tokens",
    ),
  };
}
