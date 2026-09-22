/**
 * Per-run ledger for `sv analyze`: what each phase cost in wall-clock, and
 * what each LLM task class cost in calls, tokens and time.
 *
 * The manifest already records one aggregate `tokenUsage` bucket per run.
 * That bucket cannot say which model answered — after the 2026-09-21 live
 * runs it reported seven calls to the Claude vendor when three of them went
 * to Jev — and it says nothing about speed. Both numbers are what decides
 * whether a judgment path is worth flipping to by default, so this module
 * records them per task class and per phase, and `analyze` writes the
 * snapshot to `manifest.lastAnalysis` and appends it to
 * `.sourcevision/.cache/analyses.jsonl`.
 *
 * Module-level state, reset by {@link startRunLedger} at the top of each
 * analyze command. It imports nothing from the LLM clients so both of them
 * can record into it without a cycle.
 *
 * @module sourcevision/analyzers/run-ledger
 */

import type { AnalysisRun, LLMClassUsage, TokenUsage } from "../schema/index.js";

/** One LLM call, as the client that made it saw it. */
export interface LLMCallRecord {
  /** Task class the call site declared; `unclassed` when it declared none. */
  taskClass: string;
  vendor: string;
  model: string;
  tokenUsage?: TokenUsage;
  durationMs: number;
}

let _startedAt = 0;
let _mode: AnalysisRun["mode"] = "generative";
let _phases: Record<string, number> = {};
let _byTaskClass: Record<string, LLMClassUsage> = {};
let _cacheHits = 0;
let _cacheMisses = 0;

/** Reset the ledger and start the run clock. */
export function startRunLedger(mode: AnalysisRun["mode"] = "generative"): void {
  _startedAt = Date.now();
  _mode = mode;
  _phases = {};
  _byTaskClass = {};
  _cacheHits = 0;
  _cacheMisses = 0;
}

/**
 * Set the enrichment mode once it is known. `fast` and `narrate` are decided
 * by flags at the CLI entry; `cascade` versus `generative` is decided where
 * the judgment route is resolved, so the zone pipeline sets it.
 */
export function setRunMode(mode: AnalysisRun["mode"]): void {
  _mode = mode;
}

export function recordPhaseDuration(phase: string, durationMs: number): void {
  _phases[phase] = (_phases[phase] ?? 0) + durationMs;
}

export function recordLLMCall(rec: LLMCallRecord): void {
  // One bucket per class and vendor. A class can be served by two vendors in
  // one run — Jev classifies, the text model takes the escalations — and
  // folding them together attributed Jev's tokens to the vendor that
  // happened to answer last. The first vendor keeps the bare class name;
  // another gets `class/vendor`.
  let key = rec.taskClass;
  const existing = _byTaskClass[key];
  if (existing && existing.vendor !== rec.vendor) key = `${rec.taskClass}/${rec.vendor}`;
  const bucket = (_byTaskClass[key] ??= {
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    durationMs: 0,
    vendor: rec.vendor,
    model: rec.model,
  });
  bucket.calls++;
  bucket.inputTokens += rec.tokenUsage?.input ?? 0;
  bucket.outputTokens += rec.tokenUsage?.output ?? 0;
  bucket.durationMs += rec.durationMs;
  // Within a vendor the last model to answer names the bucket (a mid-run
  // model failover is the only way it changes).
  bucket.model = rec.model;
}

export function recordJudgmentCache(hits: number, misses: number): void {
  _cacheHits += hits;
  _cacheMisses += misses;
}

/** The run so far, as it will be written to the manifest. */
export function snapshotRunLedger(): AnalysisRun {
  const run: AnalysisRun = {
    at: new Date(_startedAt || Date.now()).toISOString(),
    mode: _mode,
    durationMs: _startedAt ? Date.now() - _startedAt : 0,
    phases: { ..._phases },
    llm: { byTaskClass: structuredClone(_byTaskClass) },
  };
  if (_cacheHits + _cacheMisses > 0) {
    run.llm.judgmentCache = { hits: _cacheHits, misses: _cacheMisses };
  }
  return run;
}

/** One line per task class for the CLI's token report; empty when nothing ran. */
export function formatRunLedger(run: AnalysisRun): string[] {
  const lines: string[] = [];
  const classes = Object.entries(run.llm.byTaskClass).sort(([a], [b]) => a.localeCompare(b));
  for (const [cls, u] of classes) {
    const tokens = u.inputTokens + u.outputTokens;
    lines.push(
      `  ${cls}: ${u.calls} call${u.calls === 1 ? "" : "s"}, ${tokens.toLocaleString()} tokens, ` +
        `${(u.durationMs / 1000).toFixed(1)}s (${u.vendor} ${u.model})`,
    );
  }
  if (run.llm.judgmentCache) {
    const { hits, misses } = run.llm.judgmentCache;
    lines.push(`  judgment cache: ${hits} hit${hits === 1 ? "" : "s"}, ${misses} miss${misses === 1 ? "" : "es"}`);
  }
  return lines;
}
