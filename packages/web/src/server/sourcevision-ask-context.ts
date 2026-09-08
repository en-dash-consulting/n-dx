/**
 * Context assembly for the Ask endpoint.
 *
 * The Ask endpoint answers questions about the analyzed project. Its ground
 * truth is the `.sourcevision/` analysis, so the only real design question is
 * how much of that analysis reaches the model and how it gets there.
 *
 * ## Why a digest, and why a seam around it
 *
 * The analysis artifacts are far too large to send. Measured on this repo:
 *
 * | Artifact               | ~tokens |
 * |------------------------|--------:|
 * | `CONTEXT.md`           |   5,900 |
 * | `llms.txt`             |  13,800 |
 * | `classifications.json` |  71,900 |
 * | `inventory.json`       | 141,400 |
 * | `zones.json`           | 150,300 |
 * | `imports.json`         | 350,600 |
 *
 * `CONTEXT.md` is the one artifact written to be read by a model, and it is
 * the only one that fits comfortably alongside a question and an answer. So
 * the shipped implementation sends the digest: one call, predictable cost, and
 * an answer grounded in the same summary a human would read first.
 *
 * That choice has a real ceiling. The digest can support "what does the
 * billing zone do" and cannot support "who imports `parse.ts`" — the artifact
 * holding import edges is fifty times too large to attach. Answering that
 * class of question needs on-demand lookups, i.e. a tool-use loop, which is a
 * much larger commitment: it would be the first in-process model loop in the
 * web server, which today never blocks on a model.
 *
 * {@link AskContextSource} is the seam that keeps that door open. The route
 * depends on the interface, not on the digest, so adding a lookup-driven
 * source later is a new implementation rather than a rewrite of the route and
 * its tests.
 *
 * @module web/server/sourcevision-ask-context
 * @see packages/web/src/server/routes-sourcevision-ask.ts — the consumer
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** Assembled grounding context for one question. */
export interface AskContext {
  /** The context text to place before the question. */
  readonly text: string;
  /** Which artifacts it came from, for the answer's provenance. */
  readonly sources: readonly string[];
}

/** Raised when the project has no analysis to answer from. */
export class NoAnalysisError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NoAnalysisError";
  }
}

/**
 * Supplies the grounding context for a question.
 *
 * Implementations decide how much of the analysis to include and how to select
 * it. The digest source below sends a fixed summary; a future source could run
 * lookups driven by the question. The route knows only this interface.
 */
export interface AskContextSource {
  /**
   * Build the context for one question.
   *
   * @param input.prompt - the user's question, available to selective sources
   * @param input.seed - caller-supplied context, e.g. the finding being explained
   * @throws {NoAnalysisError} when there is no analysis to ground an answer in
   */
  assemble(input: { prompt: string; seed?: string }): Promise<AskContext>;
}

/**
 * The shipped source: the `CONTEXT.md` digest, plus the caller's seed.
 *
 * Ignores `prompt` — it sends the same digest for every question. That is the
 * whole point of the bundle approach: one predictable payload rather than a
 * selection step that could itself be wrong.
 */
export function createDigestContextSource(svDir: string): AskContextSource {
  return {
    async assemble({ seed }) {
      let digest: string;
      try {
        digest = await readFile(join(svDir, "CONTEXT.md"), "utf-8");
      } catch {
        throw new NoAnalysisError(
          "This project has not been analyzed yet — no .sourcevision/CONTEXT.md. " +
            "Run `ndx analyze .` first.",
        );
      }

      const sources = ["CONTEXT.md"];
      const parts = [
        "The following is the recorded analysis of this project. Answer only " +
          "from it; if it does not contain the answer, say so rather than " +
          "guessing.",
        "",
        "--- .sourcevision/CONTEXT.md ---",
        digest.trim(),
      ];

      if (seed?.trim()) {
        sources.push("seed");
        parts.push("", "--- context supplied with the question ---", seed.trim());
      }

      return { text: parts.join("\n"), sources };
    },
  };
}

/**
 * Render the final prompt: grounding context, then the question.
 *
 * Question last so it is the most recent thing the model reads, and stated as
 * a question rather than folded into the context block — a prompt that buries
 * the ask inside the data invites a summary instead of an answer.
 */
export function renderAskPrompt(context: AskContext, prompt: string): string {
  return [
    context.text,
    "",
    "--- question ---",
    prompt.trim(),
  ].join("\n");
}
