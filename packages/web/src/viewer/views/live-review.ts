/**
 * The running-task page's Review tab, for a run started with `--review`: the
 * stage strip above the tabs, the Findings / Reviewer log toggle, and the side
 * column section. Reading is `live-review-model.ts`.
 *
 * Findings view: the reviewer's activity from the progress events, then — once
 * hench has written `.hench/reviews/<runId>.json` — one card per finding.
 * Before the report there is activity and the log only; a review that never
 * started or lost its report says why, using the reason the run recorded.
 *
 * @module web/viewer/views/live-review
 */

import { h } from "preact";
import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import type { NavigateTo, ViewId } from "../types.js";
import type { LiveReviewFinding, LiveReviewReport, LiveTaskRun, RunEventLine } from "../hooks/index.js";
import { formatTokenCount } from "../utils/format.js";
import { formatUsd } from "./live-model.js";
import { LogTab } from "./live-log.js";
import {
  actionLabel,
  currentStep,
  findingTitle,
  modelSourceLabel,
  outcomeCounts,
  reviewStages,
  reviewStatus,
  reviewerActivity,
  severityClass,
  splitFindings,
  verdictLabel,
} from "./live-review-model.js";

type ReviewView = "findings" | "log";

// ── Stage strip ──────────────────────────────────────────────────────

/** Work → Validate → Review → Commit, with the run's current stage. */
export function StageStrip({ run, events }: { run: LiveTaskRun; events: RunEventLine[] }) {
  const stages = reviewStages(run, events);
  return h("ol", { class: "live-stages", "aria-label": "Stages" },
    stages.map((stage) => h("li", {
      key: stage.key,
      class: `live-stage live-stage-${stage.state}`,
      "aria-current": stage.state === "current" ? "step" : undefined,
    },
      stage.label,
      h("span", { class: "sr-only" }, ` (${stage.state})`),
    )));
}

// ── Findings ─────────────────────────────────────────────────────────

function FindingCard({ finding, navigateTo }: { finding: LiveReviewFinding; navigateTo: NavigateTo }) {
  const verdict = verdictLabel(finding.verdict);
  const action = actionLabel(finding.action);
  const why = finding.note ?? finding.reason;
  return h("article", { class: "live-finding" },
    h("header", { class: "live-finding-head" },
      finding.severity ? h("span", { class: `live-sev live-sev-${severityClass(finding.severity)}` }, finding.severity) : null,
      verdict ? h("span", { class: "live-chip" }, verdict) : null,
      action ? h("span", { class: `live-chip live-finding-action live-finding-action-${finding.action}` }, action) : null,
    ),
    h("h4", { class: "live-finding-title" }, findingTitle(finding)),
    finding.location ? h("p", { class: "live-finding-location live-mono" }, finding.location) : null,
    finding.scenario && finding.title ? h("p", { class: "live-finding-scenario" }, finding.scenario) : null,
    why ? h("p", { class: "live-finding-note live-muted" }, why) : null,
    finding.itemId
      ? h("p", { class: "live-finding-item" },
        "Captured as ",
        h("a", {
          href: "#",
          class: "live-more",
          onClick: (e: MouseEvent) => { e.preventDefault(); navigateTo("prd" as ViewId, { taskId: finding.itemId ?? undefined }); },
        }, finding.itemId))
      : null,
  );
}

function time(at: string): string {
  return at.length >= 19 ? at.slice(11, 19) : at;
}

function Activity({ run, events }: { run: LiveTaskRun; events: RunEventLine[] }) {
  const lines = reviewerActivity(events);
  const scope = run.startHead ? `changes since ${run.startHead.slice(0, 10)}` : null;
  if (lines.length === 0 && !scope) return null;
  return h("ul", { class: "live-review-activity", "aria-label": "Reviewer activity" },
    lines.map((e) => h("li", { key: e.seq },
      h("time", { class: "live-step-time", dateTime: e.at }, time(e.at)),
      h("span", { class: "live-step-text" },
        h("span", { class: "live-step-summary" }, e.summary),
        e.detail && e.kind === "review_started" ? h("span", { class: "live-step-detail" }, e.detail) : null,
      ))),
    scope ? h("li", { key: "scope" }, h("span", { class: "live-step-text" }, h("span", { class: "live-step-detail" }, `Scope: ${scope}`))) : null,
  );
}

function FindingsView({ run, events, navigateTo }: { run: LiveTaskRun; events: RunEventLine[]; navigateTo: NavigateTo }) {
  const status = reviewStatus(run, events);
  const report: LiveReviewReport | null = run.reviewReport;
  const step = currentStep(run, events);
  const parts: ComponentChildren[] = [h(Activity, { key: "activity", run, events })];

  if (report) {
    const { active, dropped } = splitFindings(report);
    parts.push(
      report.summary ? h("p", { key: "summary", class: "live-review-summary" }, report.summary) : null,
      report.findings.length === 0
        ? h("p", { key: "none", class: "live-muted" }, "The reviewer found nothing.")
        : h("div", { key: "cards", class: "live-findings" }, active.map((f, i) => h(FindingCard, { key: i, finding: f, navigateTo }))),
      dropped.length > 0
        ? h("details", { key: "dropped", class: "live-findings-dropped" },
          h("summary", null, `${dropped.length} dropped finding${dropped.length === 1 ? "" : "s"}`),
          h("div", { class: "live-findings" }, dropped.map((f, i) => h(FindingCard, { key: i, finding: f, navigateTo }))))
        : null,
    );
  } else if (status.state === "failed" || status.state === "never-started") {
    // No report will come: say why, from what the run recorded.
    parts.push(h("p", { key: "reason", class: "live-review-reason", role: "status" },
      h("strong", null, status.label), status.reason ? ` — ${status.reason}` : null));
  } else if (status.state === "done") {
    parts.push(h("p", { key: "lost", class: "live-review-reason", role: "status" },
      "The review finished but its report file was not found, so its findings cannot be shown. The Reviewer log has what it printed."));
  } else {
    parts.push(h("p", { key: "pending", class: "live-muted", role: "status" },
      status.state === "waiting"
        ? "The review starts when the work passes validation."
        : "The reviewer is working. Findings appear when it writes its report; its log is under Reviewer log."));
  }

  if (step) parts.push(h("p", { key: "step", class: "live-review-step", role: "status" }, h("strong", null, "Now: "), step));
  return h("div", { class: "live-review-findings" }, parts);
}

// ── Tab ──────────────────────────────────────────────────────────────

export function ReviewTab({ run, events, taskId, navigateTo }: {
  run: LiveTaskRun;
  events: RunEventLine[];
  taskId: string;
  navigateTo: NavigateTo;
}) {
  const [view, setView] = useState<ReviewView>("findings");
  const views: Array<{ id: ReviewView; label: string }> = [
    { id: "findings", label: "Findings" },
    { id: "log", label: "Reviewer log" },
  ];
  return h("div", { class: "live-work live-review" },
    h("div", { class: "live-review-toggle", role: "group", "aria-label": "Review view" },
      views.map((v) => h("button", {
        key: v.id,
        type: "button",
        class: "live-log-btn",
        "aria-pressed": view === v.id,
        onClick: () => setView(v.id),
      }, v.label))),
    view === "findings"
      ? h(FindingsView, { run, events, navigateTo })
      : h(LogTab, { run, taskId, part: "review" }),
  );
}

// ── Side column ──────────────────────────────────────────────────────

export function ReviewSection({ run, events }: { run: LiveTaskRun; events: RunEventLine[] }) {
  const status = reviewStatus(run, events);
  const counts = run.reviewReport ? outcomeCounts(run.reviewReport) : [];
  const plan = run.reviewPlan;
  const model = plan?.model ?? null;
  return h("section", { class: "live-side-section", "aria-labelledby": "lt-review-h" },
    h("h3", { id: "lt-review-h", class: "live-side-title" }, "Review"),
    h("dl", { class: "live-facts" },
      h("dt", null, "Status"), h("dd", null, status.label),
      counts.length > 0
        ? counts.map((c) => [h("dt", { key: `${c.action}-t` }, c.label), h("dd", { key: `${c.action}-d` }, String(c.count))])
        : null,
      h("dt", null, "Model"), h("dd", { class: "live-mono" }, model === null ? "not recorded" : model || "whatever is loaded"),
      h("dt", null, "Chosen by"), h("dd", null, modelSourceLabel(plan?.modelSource ?? null, run.vendor)),
      run.reviewSpend
        ? [
          h("dt", { key: "turns" }, "Turns"), h("dd", { key: "turns-d" }, String(run.reviewSpend.turns)),
          h("dt", { key: "tokens" }, "Tokens"), h("dd", { key: "tokens-d" }, formatTokenCount(run.reviewSpend.tokens)),
          h("dt", { key: "cost" }, "Cost"), h("dd", { key: "cost-d" }, formatUsd(run.reviewSpend.costUsd)),
        ]
        : null,
    ),
    h("p", { class: "live-muted" },
      plan?.optional
        ? "Review is optional for this run (--review-optional): if the reviewer cannot start, completion goes ahead with a warning."
        : "Review is a gate: completion is refused if the reviewer cannot start, unless --review-optional is passed."),
  );
}
