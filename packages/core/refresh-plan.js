const ALLOWED_REFRESH_FLAGS = new Set(["--ui-only", "--data-only", "--pr-markdown", "--no-build", "--quiet", "-q"]);

export class RefreshPlanError extends Error {
  constructor(message, suggestion) {
    super(message);
    this.name = "RefreshPlanError";
    this.suggestion = suggestion;
  }
}

/**
 * Translate refresh flags into an explicit, validated execution plan.
 */
export function buildRefreshPlan(flags) {
  const unknownFlags = flags.filter((f) => !ALLOWED_REFRESH_FLAGS.has(f));
  if (unknownFlags.length > 0) {
    throw new RefreshPlanError(
      `Unknown option(s) for refresh: ${unknownFlags.join(", ")}`,
      "Run 'ndx refresh --help' to see supported options.",
    );
  }

  const uiOnly = flags.includes("--ui-only");
  const dataOnly = flags.includes("--data-only");
  const prMarkdown = flags.includes("--pr-markdown");
  const noBuild = flags.includes("--no-build");
  const quietFlags = flags.filter((f) => f === "--quiet" || f === "-q");

  if (uiOnly && dataOnly) {
    throw new RefreshPlanError(
      "--ui-only and --data-only cannot be used together.",
      "Choose one scope flag, or omit both to run the full refresh.",
    );
  }
  if (uiOnly && prMarkdown) {
    throw new RefreshPlanError(
      "--ui-only cannot be combined with --pr-markdown.",
      "Use --pr-markdown by itself to refresh PR markdown.",
    );
  }

  const steps = [];
  const skippedSteps = [];
  const notes = [];
  let needsSourcevisionDir = false;

  if (prMarkdown) {
    needsSourcevisionDir = true;
    steps.push({ kind: "sourcevision-pr-markdown" });
    skippedSteps.push({ kind: "sourcevision-analyze", reason: "--pr-markdown" });
    skippedSteps.push({ kind: "sourcevision-dashboard-artifacts", reason: "--pr-markdown" });
    skippedSteps.push({ kind: "web-build", reason: "--pr-markdown" });
    notes.push("Refresh plan: running PR markdown refresh only; skipping data analysis and UI build.");
    return { steps, skippedSteps, quietFlags, notes, needsSourcevisionDir };
  }

  if (!uiOnly) {
    steps.push({ kind: "sourcevision-analyze" });
    steps.push({ kind: "sourcevision-dashboard-artifacts" });
  } else {
    skippedSteps.push({ kind: "sourcevision-analyze", reason: "--ui-only" });
    skippedSteps.push({ kind: "sourcevision-dashboard-artifacts", reason: "--ui-only" });
    notes.push("Refresh plan: skipping SourceVision data refresh because --ui-only was set.");
  }

  if (dataOnly) {
    skippedSteps.push({ kind: "web-build", reason: "--data-only" });
    notes.push(
      "Refresh plan: skipping UI build because --data-only was set; no implementation constraints require a UI build.",
    );
  } else if (noBuild) {
    skippedSteps.push({ kind: "web-build", reason: "--no-build" });
    notes.push("Refresh plan: skipping UI build because --no-build was set.");
  } else {
    steps.push({ kind: "web-build" });
  }

  return { steps, skippedSteps, quietFlags, notes, needsSourcevisionDir };
}
