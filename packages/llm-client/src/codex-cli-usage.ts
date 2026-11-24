import type { CompletionResult, TokenUsage } from "./types.js";

/** A single exec invocation runs one turn. Completion counters are snapshots,
 * not deltas: replacing them avoids charging replayed terminal events twice.
 * Session token_count and item events are intentionally not another source.
 */
export class CodexCliUsage {
  private pending = "";
  private usage?: TokenUsage;
  private malformed = false;
  /** Structured failure detail emitted instead of stderr in JSON mode. */
  failureMessage?: string;

  push(chunk: string): void {
    this.pending += chunk;
    let end: number;
    while ((end = this.pending.indexOf("\n")) !== -1) {
      this.line(this.pending.slice(0, end));
      this.pending = this.pending.slice(end + 1);
    }
  }

  finish(): Pick<CompletionResult, "tokenUsage" | "usageStatus"> {
    if (this.pending) this.line(this.pending);
    this.pending = "";
    return {
      tokenUsage: this.usage,
      usageStatus: this.malformed ? (this.usage ? "partial" : "malformed")
        : this.usage ? "measured" : "unavailable",
    };
  }

  private line(line: string): void {
    if (!line.trim()) return;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      this.malformed = true;
      return;
    }
    const failure = event?.type === "error" ? event.message
      : event?.type === "turn.failed" ? event.error?.message : undefined;
    if (typeof failure === "string" && failure.trim()) this.failureMessage = failure.trim();
    if (event?.type !== "turn.completed") return;
    const u = event.usage;
    const counts = [u?.input_tokens, u?.output_tokens, u?.cached_input_tokens];
    if (!counts.every(n => Number.isSafeInteger(n) && n >= 0)
      || u.cached_input_tokens > u.input_tokens) {
      this.malformed = true;
      return;
    }
    const next = {
      input: u.input_tokens - u.cached_input_tokens,
      output: u.output_tokens,
      cacheReadInput: u.cached_input_tokens,
    };
    // A regressing replay cannot replace a newer cumulative snapshot.
    if (this.usage && (u.input_tokens < this.usage.input + (this.usage.cacheReadInput ?? 0)
      || next.output < this.usage.output)) return;
    this.usage = next;
  }
}
