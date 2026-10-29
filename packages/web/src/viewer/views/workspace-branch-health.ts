/**
 * The Workspaces card's branch health strip (`git.branchHealth`).
 *
 * One line of chips — ahead/behind its base, predicted conflicts, stack
 * containment, failing PR checks — that expands to the full status from
 * `GET /api/branch-health`. The strip fetches for its own card's workspace by
 * header, like every other per-workspace read on the board, and only while
 * the toggle is on: with it off the card renders exactly as before and the
 * endpoint is never asked.
 *
 * @module web/viewer/views/workspace-branch-health
 */

import { h } from "preact";
import { useEffect, useState } from "preact/hooks";

/** The feature toggle that shows the strip and opens the endpoint. */
export const BRANCH_HEALTH_FEATURE = "git.branchHealth";

// ---------------------------------------------------------------------------
// Wire types (mirrors server/branch-health/types.ts; the viewer never imports the server)
// ---------------------------------------------------------------------------

export interface BranchHealthFailingCheck {
  name: string;
  conclusion: string;
  url: string | null;
  class: "behind-base" | "policy-test" | "codeql" | "touched-test" | "fork-no-ci" | "unclassified";
  evidence: string;
  logTail: string | null;
}

export interface BranchHealthResponse {
  branch: string | null;
  head: string;
  base: string | null;
  baseSource: "pr" | "upstream" | "default" | null;
  ahead: number | null;
  behind: number | null;
  conflicts: Array<{ path: string; stages: number[] }>;
  conflictsUnavailable: string | null;
  stack: Array<{ branch: string; contained: boolean }>;
  github: {
    number: number;
    url: string;
    baseRefName: string;
    isCrossRepository: boolean;
    mergeable: string;
    mergeStateStatus: string;
    reviewDecision: string | null;
    checks: { total: number; failing: number; pending: number };
    failing: BranchHealthFailingCheck[];
  } | null;
  githubReason: string | null;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

export type HealthTone = "ok" | "warn" | "bad" | "info";

export interface HealthChip {
  text: string;
  tone: HealthTone;
}

/** The strip's chips, in reading order. */
export function branchHealthChips(health: BranchHealthResponse): HealthChip[] {
  const chips: HealthChip[] = [];
  if (health.base === null) {
    chips.push({ text: "no base", tone: "info" });
  } else {
    const behind = health.behind ?? 0;
    chips.push({
      text: `↑${health.ahead ?? "?"} ↓${health.behind ?? "?"} ${health.base}`,
      tone: behind > 0 ? "warn" : "ok",
    });
    if (health.conflictsUnavailable === null) {
      const n = health.conflicts.length;
      chips.push(n > 0
        ? { text: `${n} conflict${n === 1 ? "" : "s"}`, tone: "bad" }
        : { text: "merges clean", tone: "ok" });
    }
  }
  if (health.stack.length > 0) {
    const missing = health.stack.filter((layer) => !layer.contained).length;
    chips.push(missing > 0
      ? { text: `stack: ${missing} not contained`, tone: "bad" }
      : { text: `stack of ${health.stack.length} contained`, tone: "ok" });
  }
  if (health.github) {
    const { failing, pending } = health.github.checks;
    chips.push(failing > 0
      ? { text: `PR #${health.github.number}: ${failing} failing`, tone: "bad" }
      : { text: `PR #${health.github.number}${pending > 0 ? `: ${pending} pending` : ": checks pass"}`, tone: pending > 0 ? "info" : "ok" });
  }
  return chips;
}

const BASE_SOURCE_LABEL: Record<NonNullable<BranchHealthResponse["baseSource"]>, string> = {
  pr: "the PR's base",
  upstream: "the upstream branch",
  default: "origin's default branch",
};

const STAGE_LABEL: Record<number, string> = { 1: "ancestor", 2: "base", 3: "this branch" };

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

function Details({ health }: { health: BranchHealthResponse }) {
  return h("div", { class: "branch-health-details" },
    h("p", { class: "branch-health-line" },
      health.base
        ? `Compared with ${health.base} (${BASE_SOURCE_LABEL[health.baseSource ?? "default"]}) at ${health.head.slice(0, 9)}.`
        : "No base branch: no PR, no upstream naming another branch, and no origin default branch.",
    ),

    health.conflictsUnavailable
      ? h("p", { class: "branch-health-line" }, health.conflictsUnavailable)
      : health.conflicts.length > 0
        ? h("div", null,
            h("h4", { class: "branch-health-heading" }, "Predicted conflicts"),
            h("ul", { class: "branch-health-list" },
              health.conflicts.map((c) => h("li", { key: c.path },
                h("code", null, c.path),
                ` — stages: ${c.stages.map((s) => STAGE_LABEL[s] ?? String(s)).join(", ")}`,
              )),
            ),
          )
        : null,

    health.stack.length > 0
      ? h("div", null,
          h("h4", { class: "branch-health-heading" }, "Stack"),
          h("ul", { class: "branch-health-list" },
            health.stack.map((layer) => h("li", { key: layer.branch },
              h("code", null, layer.branch),
              layer.contained ? " — contained" : " — not contained: it has commits this branch lacks",
            )),
          ),
        )
      : null,

    health.github
      ? h("div", null,
          h("h4", { class: "branch-health-heading" },
            h("a", { href: health.github.url, target: "_blank", rel: "noopener noreferrer" }, `PR #${health.github.number}`),
            ` · ${health.github.mergeStateStatus.toLowerCase()} · ${(health.github.reviewDecision ?? "no review decision").toLowerCase().replace(/_/g, " ")}`,
          ),
          health.github.failing.length > 0
            ? h("ul", { class: "branch-health-list" },
                health.github.failing.map((check) => h("li", { key: check.name },
                  h("span", { class: "branch-health-class" }, check.class),
                  " ",
                  check.url ? h("a", { href: check.url, target: "_blank", rel: "noopener noreferrer" }, check.name) : check.name,
                  ` — ${check.evidence}`,
                  check.logTail
                    ? h("details", { class: "branch-health-log" },
                        h("summary", null, "Failed log tail"),
                        h("pre", null, check.logTail),
                      )
                    : null,
                )),
              )
            : null,
        )
      : h("p", { class: "branch-health-line" }, health.githubReason ?? "No GitHub facts."),
  );
}

/**
 * The strip for one card. `doFetch` addresses the card's workspace; the
 * strip is refetched when the card's branch changes.
 */
export function BranchHealthStrip({ workspace, branch, doFetch }: {
  workspace: string;
  branch: string | null;
  doFetch: (path: string) => Promise<Response>;
}) {
  const [health, setHealth] = useState<BranchHealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const res = await doFetch("/api/branch-health");
        const body = (await res.json()) as BranchHealthResponse & { error?: string };
        if (!live) return;
        if (!res.ok) {
          setError(body.error ?? `Branch health failed (${res.status})`);
          setHealth(null);
        } else {
          setHealth(body);
          setError(null);
        }
      } catch (err) {
        if (live) setError(err instanceof Error ? err.message : "Branch health failed");
      }
    })();
    return () => {
      live = false;
    };
    // doFetch is stable per board; the branch is what changes the answer.
  }, [workspace, branch, doFetch]);

  if (error) return h("p", { class: "branch-health-strip branch-health-error" }, error);
  if (!health) return h("p", { class: "branch-health-strip branch-health-loading" }, "Reading branch health…");

  const detailsId = `branch-health-${workspace}`;
  return h("div", { class: "branch-health" },
    h("button", {
      type: "button",
      class: "branch-health-strip",
      "aria-expanded": open ? "true" : "false",
      "aria-controls": detailsId,
      "aria-label": `Branch health for ${workspace}`,
      onClick: () => setOpen((v) => !v),
    },
      branchHealthChips(health).map((chip) =>
        h("span", { key: chip.text, class: `branch-health-chip branch-health-chip-${chip.tone}` }, chip.text)),
    ),
    open ? h("div", { id: detailsId }, h(Details, { health })) : null,
  );
}
