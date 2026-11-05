/**
 * Plan's health panel: the last validation result as up to four lights
 * (cycles, orphans, unresolved dependencies, stale release plans), the time it
 * ran, and Check, Fix… and Reshape…. Fix and Reshape are the Validation view's
 * own actions, which preview before they write; "Open" goes to that view.
 *
 * Reads `GET /api/rex/validate` — the same report the Validation view runs.
 *
 * @module viewer/views/plan-health
 */

import { h } from "preact";
import { useState, useEffect, useCallback } from "preact/hooks";
import { ValidationActions, type ValidationActionKind } from "./validation.js";

interface HealthCheck {
  name: string;
  pass: boolean;
  severity?: "error" | "warn";
  errors: unknown[];
}

/** The slice of the validate report the panel reads. */
export interface HealthReport {
  checks: HealthCheck[];
  ranAt?: string;
}

export interface HealthLight {
  id: "cycles" | "orphans" | "dependencies" | "release-plans";
  label: string;
  /** `ok` when the check passed, otherwise the check's severity. */
  state: "ok" | "warn" | "fail";
  count: number;
}

/**
 * Which validate check each light reads. Orphans are items placed under a
 * parent their type does not allow; unresolved dependencies are blockedBy
 * references to an unknown id (duplicate ids and self-references stay in DAG
 * integrity, which no light reads). Release plans only
 * exist on a v2 project, so a report without that check draws three lights.
 */
const LIGHTS: ReadonlyArray<{ id: HealthLight["id"]; label: string; check: string }> = [
  { id: "cycles", label: "Cycles", check: "blockedBy cycles" },
  { id: "orphans", label: "Orphans", check: "hierarchy placement" },
  { id: "dependencies", label: "Unresolved dependencies", check: "unresolved dependencies" },
  { id: "release-plans", label: "Stale release plans", check: "release plans" },
];

export function healthLights(report: HealthReport): HealthLight[] {
  const lights: HealthLight[] = [];
  for (const { id, label, check } of LIGHTS) {
    const found = report.checks.find((c) => c.name === check);
    if (!found) continue;
    lights.push({ id, label, count: found.errors.length, state: found.pass ? "ok" : found.severity === "warn" ? "warn" : "fail" });
  }
  return lights;
}

const STATE_TEXT: Record<HealthLight["state"], string> = { ok: "OK", warn: "Warning", fail: "Failing" };

type Load =
  | { state: "idle" }
  | { state: "running" }
  | { state: "error"; message: string }
  | { state: "done"; report: HealthReport };

export function PlanHealth() {
  const [load, setLoad] = useState<Load>({ state: "idle" });
  const [open, setOpen] = useState<ValidationActionKind | null>(null);

  const check = useCallback(async () => {
    setLoad({ state: "running" });
    try {
      const res = await fetch("/api/rex/validate");
      const body = await res.json().catch(() => ({})) as Partial<HealthReport> & { error?: string };
      if (!res.ok) {
        setLoad({ state: "error", message: body.error ?? `HTTP ${res.status}` });
        return;
      }
      setLoad({ state: "done", report: { checks: body.checks ?? [], ranAt: body.ranAt } });
    } catch {
      setLoad({ state: "error", message: "Could not run validation. Is the server running?" });
    }
  }, []);

  // The panel opens on the current result rather than an empty prompt: a check
  // only reads the PRD, so running one on mount is safe.
  useEffect(() => { void check(); }, [check]);

  const running = load.state === "running";
  const lights = load.state === "done" ? healthLights(load.report) : [];
  const ranAt = load.state === "done" && load.report.ranAt ? new Date(load.report.ranAt) : null;
  const toggle = (kind: ValidationActionKind) => setOpen(open === kind ? null : kind);

  return h("div", { class: "plan-health" },
    load.state === "error" ? h("p", { class: "ph-error", role: "alert" }, load.message) : null,
    lights.length > 0
      ? h("ul", { class: "ph-lights", "aria-label": "Plan health" },
        lights.map((light) =>
          h("li", { key: light.id, class: `ph-light ph-${light.state}`, "data-light": light.id },
            h("span", { class: "ph-dot", "aria-hidden": "true" }),
            h("span", { class: "ph-label" }, light.label),
            h("span", { class: "ph-count" }, light.state === "ok" ? STATE_TEXT.ok : `${STATE_TEXT[light.state]} · ${light.count}`),
          )),
      )
      : load.state === "running" ? h("p", { class: "ph-status", role: "status" }, "Checking...") : null,
    ranAt && !isNaN(ranAt.getTime())
      ? h("p", { class: "ph-ran" }, "Checked ", h("time", { dateTime: ranAt.toISOString() }, ranAt.toLocaleString()))
      : null,
    h("div", { class: "ph-actions" },
      h("button", { type: "button", class: "ph-btn", disabled: running, onClick: () => void check() }, running ? "Checking..." : "Check"),
      h("button", { type: "button", class: "ph-btn", "aria-expanded": open === "fix", onClick: () => toggle("fix") }, "Fix…"),
      h("button", { type: "button", class: "ph-btn", "aria-expanded": open === "reshape", onClick: () => toggle("reshape") }, "Reshape…"),
    ),
    // Previews first, writes only on the confirm button inside; a write re-checks.
    open ? h(ValidationActions, { key: open, show: [open], onChanged: () => void check() }) : null,
  );
}
