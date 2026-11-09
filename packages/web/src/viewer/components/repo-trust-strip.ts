/**
 * Repository trust strip — "this checkout widens what n-dx may execute, and
 * you have not said that is fine".
 *
 * Shown at the top of every page while `GET /api/trust` reports the
 * repository as `untrusted` or `changed`. It names the findings, says what is
 * being restricted meanwhile (hench runs under the default guard,
 * bypassPermissions is lowered, verify_criteria does not run the test
 * command), and offers the one action: trust this configuration. Trusting
 * records a digest in the user's ndx home through `POST /api/trust/accept`;
 * the strip re-fetches and disappears. "Not now" hides it for this page load
 * only — the restriction stays, and so does the CLI warning.
 *
 * Renders nothing for `baseline` and `trusted`, and nothing while loading or
 * when the route is unavailable (a standalone viewer without the server).
 */

import { h } from "preact";
import { useCallback, useEffect, useState } from "preact/hooks";

export type RepoTrustState = "baseline" | "trusted" | "untrusted" | "changed";

export interface RepoTrustFindingView {
  code: string;
  severity: "warning" | "info";
  message: string;
  values: string[];
}

export interface RepoTrustView {
  state: RepoTrustState;
  restricted: boolean;
  findings: RepoTrustFindingView[];
  sources: string[];
  /** PRD items with a saved run block. Absent from an older server. */
  prdRunBlocks?: number;
  inventory?: {
    prd: { items: number; epics: number } | null;
    analysis: { analyzedAt: string | null; version: string | null } | null;
    henchRuns: number | null;
  };
}

export interface RepoTrustNotice {
  headline: string;
  detail: string;
  warnings: string[];
  infos: string[];
  /** Sources for the Details list, capped at MAX_LISTED_SOURCES. */
  sources: string[];
  /** Sources beyond the Details cap. */
  moreSources: number;
}

/** Sources named in the always-visible line; the rest become "+N more". */
const MAX_NAMED_SOURCES = 3;
/** Longest source name printed in the always-visible line. */
const MAX_SOURCE_NAME = 60;
/** Total characters of source names in the always-visible line. */
const MAX_NAMED_CHARS = 140;
/** Sources listed under Details before "+N more". */
const MAX_LISTED_SOURCES = 50;

/** The grouped PRD entry llm-client adds to `sources`, e.g. `.rex/changes/** (214 PRD items with saved run settings)`. */
const GROUPED_PRD_SOURCE = /\(\d+ PRD items? with saved run settings\)$/;

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * Pure computation of the strip's text, exported for direct unit testing.
 * Returns null when there is nothing to show.
 */
export function buildTrustNotice(view: RepoTrustView | null): RepoTrustNotice | null {
  if (!view || !view.restricted) return null;
  const warnings = view.findings.filter((f) => f.severity === "warning").map((f) => f.message);
  const infos = view.findings.filter((f) => f.severity === "info").map((f) => f.message);
  const n = warnings.length;
  const headline = view.state === "changed"
    ? "This repository's execution config changed since you trusted it"
    : "This repository's execution config is not trusted";
  // The PRD count has its own phrase, so the grouped entry is not also named.
  const prdCount = view.prdRunBlocks ?? 0;
  const prdPhrase = prdCount > 0
    ? ` and ${prdCount} PRD item${prdCount === 1 ? "" : "s"} with saved run settings`
    : "";
  const nameable = prdCount > 0 ? view.sources.filter((s) => !GROUPED_PRD_SOURCE.test(s)) : view.sources;
  // The phrase shares the line's budget, so the visible text stays under its cap.
  const budget = MAX_NAMED_CHARS - prdPhrase.length;
  const named: string[] = [];
  let namedChars = 0;
  for (const source of nameable.slice(0, MAX_NAMED_SOURCES)) {
    const name = clip(source, MAX_SOURCE_NAME);
    if (named.length > 0 && namedChars + name.length > budget) break;
    named.push(name);
    namedChars += name.length;
  }
  const rest = nameable.length - named.length;
  const list = rest > 0 ? [...named, `+${rest} more`] : named;
  const sources = list.length ? ` (${list.join(", ")})` : "";
  const detail =
    `${n} finding${n === 1 ? "" : "s"}${sources}${prdPhrase}. Until trusted, agent runs use the default guard, `
    + "bypassPermissions is lowered to acceptEdits, and verify_criteria does not run the repository's test command.";
  return {
    headline,
    detail,
    warnings,
    infos,
    sources: view.sources.slice(0, MAX_LISTED_SOURCES),
    moreSources: Math.max(0, view.sources.length - MAX_LISTED_SOURCES),
  };
}

export interface RepoTrustStripProps {
  /** Injected for tests; defaults to the global, base-path-aware fetch. */
  fetchImpl?: typeof fetch;
  /** Injected for tests; skips the initial fetch when provided. */
  initial?: RepoTrustView | null;
}

export function RepoTrustStrip({ fetchImpl, initial }: RepoTrustStripProps = {}) {
  const doFetch = fetchImpl ?? fetch;
  const [view, setView] = useState<RepoTrustView | null>(initial ?? null);
  const [hidden, setHidden] = useState(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await doFetch("/api/trust");
      if (!res.ok) return;
      setView((await res.json()) as RepoTrustView);
    } catch {
      // No server (static export) or no route: nothing to show.
    }
  }, [doFetch]);

  useEffect(() => {
    if (initial === undefined) void load();
  }, [initial, load]);

  const accept = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await doFetch("/api/trust/accept", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (!res.ok) {
        setError(`Could not record trust (HTTP ${res.status}).`);
        return;
      }
      setView((await res.json()) as RepoTrustView);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not record trust.");
    } finally {
      setBusy(false);
    }
  }, [doFetch]);

  const notice = buildTrustNotice(view);
  if (!notice || hidden) return null;

  return h("div", { class: "repo-trust-strip", role: "alert" },
    h("div", { class: "repo-trust-strip__row" },
      h("span", { class: "repo-trust-strip__icon", "aria-hidden": "true" }, "⚠"),
      h("div", { class: "repo-trust-strip__text" },
        h("strong", null, notice.headline),
        h("span", null, " " + notice.detail),
      ),
      h("div", { class: "repo-trust-strip__actions" },
        h("button", { type: "button", class: "repo-trust-strip__btn", onClick: () => setOpen(!open), "aria-expanded": open },
          open ? "Hide details" : "Details"),
        h("button", { type: "button", class: "repo-trust-strip__btn repo-trust-strip__btn--primary", disabled: busy, onClick: () => void accept() },
          busy ? "Recording…" : "Trust this configuration"),
        h("button", { type: "button", class: "repo-trust-strip__btn", onClick: () => setHidden(true) }, "Not now"),
      ),
    ),
    open
      ? h("div", { class: "repo-trust-strip__details" },
          h("ul", { class: "repo-trust-strip__list" },
            ...notice.warnings.map((m) => h("li", { class: "repo-trust-strip__warning" }, m)),
            ...notice.infos.map((m) => h("li", { class: "repo-trust-strip__info" }, m)),
          ),
          notice.sources.length
            ? h("div", { class: "repo-trust-strip__sources" },
                "Read from:",
                h("ul", null,
                  ...notice.sources.map((p) => h("li", { class: "repo-trust-strip__source" }, p)),
                  notice.moreSources > 0 ? h("li", { class: "repo-trust-strip__source" }, `+${notice.moreSources} more`) : null,
                ),
              )
            : null,
        )
      : null,
    error ? h("div", { class: "repo-trust-strip__error", role: "status" }, error) : null,
  );
}
