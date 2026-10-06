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
  const sources = view.sources.length ? ` (${view.sources.join(", ")})` : "";
  const detail =
    `${n} finding${n === 1 ? "" : "s"}${sources}. Until trusted, agent runs use the default guard, `
    + "bypassPermissions is lowered to acceptEdits, and verify_criteria does not run the repository's test command.";
  return { headline, detail, warnings, infos };
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
      ? h("ul", { class: "repo-trust-strip__list" },
          ...notice.warnings.map((m) => h("li", { class: "repo-trust-strip__warning" }, m)),
          ...notice.infos.map((m) => h("li", { class: "repo-trust-strip__info" }, m)),
        )
      : null,
    error ? h("div", { class: "repo-trust-strip__error", role: "status" }, error) : null,
  );
}
