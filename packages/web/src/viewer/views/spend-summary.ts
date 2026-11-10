/**
 * The Spend tile's folded summary on Tune: what the project has spent, how
 * close it is to its budget, and where the spend went, in a few lines. The
 * tile opens the full Token usage view (views/token-usage.ts) for the
 * breakdown, charts and per-item table.
 *
 * Reads the same `GET /api/token/utilization` the full view reads, with its
 * default period, so the two never disagree about a total.
 *
 * @module viewer/views/spend-summary
 */

import { h } from "preact";
import { useCallback, useEffect, useState } from "preact/hooks";
import { usePolling } from "../hooks/index.js";
import { USAGE_POLL_INTERVAL_MS } from "../usage/constants.js";

/** The slice of the utilization reply this summary reads. */
export interface SpendReply {
  cost?: { total?: string; totalRaw?: number };
  trend?: Array<{ period: string; estimatedCost?: { total?: string } }>;
  commands?: Array<{ command: string; package: string; inputTokens?: number; outputTokens?: number; cacheCreationTokens?: number; cacheReadTokens?: number }>;
  budget?: {
    severity?: "ok" | "warning" | "exceeded";
    cost?: { used: number; budget: number; percent: number };
    tokens?: { used: number; budget: number; percent: number };
  };
}

const SPEND_POLL_KEY = "spend-tile-summary";
const PKG_LABELS: Record<string, string> = { hench: "Agent runs", rex: "Planning", sv: "Analysis", web: "Dashboard", sidecar: "Sidecar" };
const TOP_COMMANDS = 3;

const tokensOf = (c: NonNullable<SpendReply["commands"]>[number]) =>
  (c.inputTokens ?? 0) + (c.outputTokens ?? 0) + (c.cacheCreationTokens ?? 0) + (c.cacheReadTokens ?? 0);

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

/** What the summary says, computed apart from rendering so it can be tested on its own. */
export function spendLines(reply: SpendReply): {
  total: string;
  latest: { period: string; total: string } | null;
  budget: { label: string; tone: "ok" | "warning" | "exceeded" } | null;
  top: Array<{ label: string; share: number; tokens: string }>;
} {
  const latest = reply.trend?.at(-1);
  const dim = reply.budget?.cost ?? reply.budget?.tokens;
  const commands = [...(reply.commands ?? [])].sort((a, b) => tokensOf(b) - tokensOf(a));
  const all = commands.reduce((n, c) => n + tokensOf(c), 0);
  return {
    total: reply.cost?.total ?? "$0.00",
    latest: latest?.estimatedCost?.total ? { period: latest.period, total: latest.estimatedCost.total } : null,
    budget: dim
      ? {
          label: `${Math.round(dim.percent)}% of the ${reply.budget?.cost ? "cost" : "token"} budget used`,
          tone: reply.budget?.severity ?? "ok",
        }
      : null,
    top: commands.slice(0, TOP_COMMANDS).filter((c) => tokensOf(c) > 0).map((c) => ({
      label: `${PKG_LABELS[c.package] ?? c.package}: ${c.command}`,
      share: all > 0 ? tokensOf(c) / all : 0,
      tokens: fmtTokens(tokensOf(c)),
    })),
  };
}

export function SpendSummary() {
  const [reply, setReply] = useState<SpendReply | null>(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/token/utilization?period=day");
      if (!res.ok) throw new Error(String(res.status));
      setReply((await res.json()) as SpendReply);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  usePolling(SPEND_POLL_KEY, load, USAGE_POLL_INTERVAL_MS);

  if (!reply) return h("p", { class: "tile-sum-empty" }, failed ? "Could not load spend." : "Loading…");
  const lines = spendLines(reply);
  return h("div", { class: "spend-summary" },
    h("p", { class: "tile-sum-headline" },
      h("strong", null, lines.total), " estimated spend",
      lines.latest ? ` · ${lines.latest.total} on ${lines.latest.period}` : null,
    ),
    lines.budget
      ? h("div", { class: "tile-sum-chips" },
          h("span", { class: `tile-sum-chip${lines.budget.tone === "ok" ? "" : ` tile-sum-chip--${lines.budget.tone === "exceeded" ? "critical" : "warning"}`}` },
            h("strong", null, lines.budget.label)))
      : null,
    lines.top.length > 0
      ? h("ul", { class: "tile-sum-list tile-sum-bars", role: "list", "aria-label": "Where the tokens went" },
          lines.top.map((t) =>
            h("li", { key: t.label, class: "tile-sum-bar" },
              h("span", { class: "tile-sum-bar-label", title: t.label }, t.label),
              h("span", { class: "tile-sum-bar-track", "aria-hidden": "true" },
                h("span", { class: "tile-sum-bar-fill tile-sum-bar-fill--neutral", style: `width: ${Math.max(2, Math.round(t.share * 100))}%` })),
              h("span", { class: "tile-sum-bar-value" }, t.tokens),
            )))
      : h("p", { class: "tile-sum-empty" }, "No spend recorded yet."),
  );
}
