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

/**
 * A finding handed to the endpoint to be explained.
 *
 * Structured rather than prose. The caller could send a sentence naming the
 * zone, but the model would then be reading someone's summary of the finding
 * instead of the finding, and whatever the summary left out would be gone. Named
 * fields also survive assertion: a test can check the zone and files arrived.
 */
export interface AskFindingSeed {
  type: string;
  severity?: string;
  zone: string;
  message: string;
  files: string[];
}

/**
 * Render a finding as labelled context lines.
 *
 * Field-per-line rather than JSON: both are structured, but this is the form
 * the surrounding digest is already in, and a model reading `zone: billing`
 * beside a `CONTEXT.md` section about `billing` connects them without being
 * told to. Absent severity is omitted rather than defaulted — the analysis did
 * not classify it, and saying "info" would be asserting something it never did.
 */
export function renderFindingSeed(finding: AskFindingSeed): string {
  const lines = [
    `type: ${finding.type}`,
    ...(finding.severity ? [`severity: ${finding.severity}`] : []),
    `zone: ${finding.zone}`,
    `files: ${finding.files.length > 0 ? finding.files.join(", ") : "(none recorded)"}`,
    `message: ${finding.message}`,
  ];
  return lines.join("\n");
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
   * @param input.seed - caller-supplied free text to include alongside it
   * @param input.finding - a finding to explain, as structured fields
   * @throws {NoAnalysisError} when there is no analysis to ground an answer in
   */
  assemble(input: {
    prompt: string;
    seed?: string;
    finding?: AskFindingSeed;
  }): Promise<AskContext>;
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
    async assemble({ seed, finding }) {
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

      // After the digest, so the finding is read against the analysis it came
      // from rather than in isolation — the zone named here is a zone the
      // digest above has already described.
      if (finding) {
        sources.push("finding");
        parts.push("", "--- the finding to explain ---", renderFindingSeed(finding));
      }

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
