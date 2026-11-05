/**
 * The run classifier's verdict as a run file holds it (`RunRecord.diagnosis`).
 *
 * Web never imports hench: the verdict is read from the run file and typed
 * here. Read by the runs routes and by the Sidecar's Diagnose run packet.
 * Mirrors hench's `RunDiagnosis` in `schema/v1.ts`.
 */

export interface RunDiagnosisSummary {
  class: string;
  summary: string;
  evidence: string[];
  /** Ranked, best first. */
  actions: Array<{ kind: string; label: string }>;
  attempt: { n: number; of: number };
}

/** The run file's `diagnosis`, when it has the shape hench writes; otherwise absent. */
export function readDiagnosis(value: unknown): RunDiagnosisSummary | undefined {
  if (!value || typeof value !== "object") return undefined;
  const d = value as Record<string, unknown>;
  const attempt = d.attempt as Record<string, unknown> | undefined;
  if (typeof d.class !== "string" || typeof d.summary !== "string" || !Array.isArray(d.actions)
    || typeof attempt?.n !== "number" || typeof attempt?.of !== "number") {
    return undefined;
  }
  return {
    class: d.class,
    summary: d.summary,
    evidence: Array.isArray(d.evidence) ? d.evidence.filter((e): e is string => typeof e === "string") : [],
    actions: d.actions
      .filter((a): a is { kind: string; label: string } =>
        !!a && typeof (a as { kind?: unknown }).kind === "string" && typeof (a as { label?: unknown }).label === "string")
      .map((a) => ({ kind: a.kind, label: a.label })),
    attempt: { n: attempt.n, of: attempt.of },
  };
}
