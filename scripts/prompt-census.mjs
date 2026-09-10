#!/usr/bin/env node
/**
 * Prompt token-cost census — measure every LLM prompt surface in the monorepo.
 *
 * The point of this tool is to make "we made the prompts cheaper" a number
 * instead of a claim. It records the token cost of every prompt surface that
 * reaches an LLM, before and after a rewrite, from one declared registry.
 *
 *   node scripts/prompt-census.mjs                  # measure HEAD, print a table
 *   node scripts/prompt-census.mjs --json           # same, machine-readable
 *   node scripts/prompt-census.mjs --compare        # before/after vs the baseline
 *   node scripts/prompt-census.mjs --compare --baseline <path>   # vs another one
 *   node scripts/prompt-census.mjs --write          # rewrite the checked-in baseline
 *   node scripts/prompt-census.mjs --dump <pkg>     # print one assembled prompt
 *   node scripts/prompt-census.mjs --check          # fail if the registry is stale
 *
 * ## How a surface is measured
 *
 * Two numbers per surface, because they move for different reasons:
 *
 * - **fixed** — the prompt text the builder always emits, extracted statically
 *   from the string literals in its body. This is the part a rewrite reduces.
 * - **assembled** — the length of a real prompt built from a fixed
 *   representative input. Only available for the four `--dump` entry points.
 *   `assembled - fixed` is the per-run context, which a rewrite does *not*
 *   reduce and which must not be credited to one.
 *
 * Static extraction is what makes the construction styles comparable. core
 * writes a few large template literals; hench pushes dozens of short fragments
 * onto an array; rex and sourcevision declare a list of named sections.
 * Counting *literals in the function body* catches all three — a
 * literal-per-file scan undercounts the latter two badly, and measuring only
 * assembled output cannot separate fixed text from context.
 *
 * For the four `--dump` entry points the real builder is called, so those also
 * report a per-section split. That is the table a rewrite reads first: it names
 * which *part* of a prompt carries the bill, not just which builder.
 *
 * ## Token counting
 *
 * Counts come from `budgetPreflight()` in @n-dx/llm-client, the same estimator
 * the runtime uses to decide whether a prompt fits a context window. This tool
 * deliberately does not add a second estimator: a number produced here has to
 * be the number the runtime would produce for the same text.
 *
 * ## Scope
 *
 * In scope: prompt text sent to a model. Out of scope: interactive readline
 * prompts (`promptUser`, `confirmPrompt`, `promptLine`, …) — those are
 * questions to a human. They are listed explicitly in OUT_OF_SCOPE below so a
 * later audit does not mistake one for an LLM prompt, and so that a
 * confusingly-named one (rex's `buildPrompt`, which feeds `promptLine`) stays
 * classified rather than rediscovered.
 *
 * @see docs/analysis/prompt-token-baseline.md — the generated inventory
 * @see tests/e2e/prompt-census.test.js — registry staleness enforcement
 */

import { readFileSync, writeFileSync, existsSync, realpathSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
// Only `--write` shells out, and only to establish whether the tree is clean.
// See treeState() for why reading .git/ was not enough. This script is listed
// under "Development scripts" in the ALLOWED set of
// tests/e2e/architecture-policy.test.js.
import { execFileSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE_JSON = join(ROOT, "docs/analysis/prompt-token-baseline.json");
const BASELINE_MD = join(ROOT, "docs/analysis/prompt-token-baseline.md");

/**
 * TypeScript resolves from the web package, the workspace member that depends
 * on it most directly. Same resolution trick as scripts/build-iso-skill.mjs.
 */
const require = createRequire(join(ROOT, "packages/web/package.json"));

// ── Registry: declared LLM prompt surfaces ───────────────────────────────────

/**
 * Every prompt surface that reaches a model, one entry per builder.
 *
 * `builder` names the enclosing function whose string literals form the prompt.
 * For surfaces where the prompt is an inline template literal rather than an
 * extracted builder, `builder` names the function that contains it and
 * `inline: true` records that there is no dedicated builder to rewrite.
 */
const SURFACES = [
  // ── rex ────────────────────────────────────────────────────────────────
  //
  // Every rex surface names its `*Envelope` builder, which is where the prompt
  // literals live since the envelope migration. The `*Prompt` function beside
  // each one is a two-line `assemblePromptText(...)` wrapper and would measure
  // at zero, so naming the wrapper here would silently zero out the surface.
  //
  // Per-section cost is not recorded per surface: sections exist at runtime,
  // and this registry is measured statically. The section breakdown comes from
  // the `--dump` fixtures below, which call the real builders.
  {
    pkg: "rex",
    file: "packages/rex/src/analyze/reason.ts",
    builder: "buildFileImportEnvelope",
    purpose: "Propose PRD items from a single source document.",
  },
  {
    pkg: "rex",
    file: "packages/rex/src/analyze/reason.ts",
    builder: "buildScanImportEnvelope",
    purpose: "Propose PRD items from a batch of scanner findings.",
  },
  {
    pkg: "rex",
    file: "packages/rex/src/analyze/reason.ts",
    builder: "buildAddEnvelope",
    purpose: "Propose new PRD items from a natural-language description.",
  },
  {
    pkg: "rex",
    file: "packages/rex/src/analyze/reason.ts",
    builder: "buildMultiAddEnvelope",
    purpose: "Propose items for several scan targets in one call.",
  },
  {
    pkg: "rex",
    file: "packages/rex/src/analyze/reason.ts",
    builder: "buildBreakdownEnvelope",
    purpose: "Split proposals judged too large into child tasks.",
  },
  {
    pkg: "rex",
    file: "packages/rex/src/analyze/reason.ts",
    builder: "buildConsolidateEnvelope",
    purpose: "Merge overlapping proposals before they enter the PRD.",
  },
  {
    pkg: "rex",
    file: "packages/rex/src/analyze/reason.ts",
    builder: "buildAssessmentEnvelope",
    purpose: "Assess whether proposal tasks are at the right granularity.",
  },
  {
    pkg: "rex",
    file: "packages/rex/src/analyze/reason.ts",
    builder: "buildIdeasEnvelope",
    purpose: "Extract proposals from free-form notes that local parsing missed.",
  },
  {
    pkg: "rex",
    file: "packages/rex/src/analyze/consolidation-guard.ts",
    builder: "buildConsolidationGuardEnvelope",
    purpose: "Second-opinion check before a consolidation is applied.",
  },
  {
    pkg: "rex",
    file: "packages/rex/src/analyze/decompose.ts",
    builder: "buildDecompositionEnvelope",
    purpose: "Decompose a task whose level-of-effort exceeds the threshold.",
  },
  {
    pkg: "rex",
    file: "packages/rex/src/analyze/extract.ts",
    builder: "buildDisambiguationEnvelope",
    purpose: "Resolve an ambiguous extraction against existing PRD items.",
  },
  {
    pkg: "rex",
    file: "packages/rex/src/analyze/guided.ts",
    builder: "buildClarifyEnvelope",
    purpose: "Ask clarifying questions during guided PRD authoring.",
  },
  {
    pkg: "rex",
    file: "packages/rex/src/analyze/guided.ts",
    builder: "buildSpecEnvelope",
    purpose: "Turn guided answers into a structured spec.",
  },
  {
    pkg: "rex",
    file: "packages/rex/src/analyze/modify-reason.ts",
    builder: "buildModifyEnvelope",
    purpose: "Apply a natural-language edit to an existing PRD item.",
  },
  {
    pkg: "rex",
    file: "packages/rex/src/analyze/propose-group-renames.ts",
    builder: "buildGroupRenameEnvelope",
    purpose: "Rename a group of sibling items to a consistent scheme.",
  },
  {
    pkg: "rex",
    file: "packages/rex/src/analyze/rename-resolve.ts",
    builder: "buildRenameEnvelope",
    purpose: "Pick the better of two colliding item titles.",
  },
  {
    pkg: "rex",
    file: "packages/rex/src/analyze/reshape-reason.ts",
    builder: "buildReshapeEnvelope",
    purpose: "Propose a restructure of the PRD hierarchy.",
  },
  {
    pkg: "rex",
    file: "packages/rex/src/analyze/reshape-reason.ts",
    builder: "buildBodyMergeEnvelope",
    purpose: "Merge two item descriptions into one during a reshape.",
  },
  {
    pkg: "rex",
    file: "packages/rex/src/analyze/escalate.ts",
    builder: "buildValidationFeedbackEnvelope",
    purpose: "Retry feedback appended to a prompt whose response failed validation.",
  },

  // ── sourcevision ───────────────────────────────────────────────────────
  {
    pkg: "sourcevision",
    file: "packages/sourcevision/src/analyzers/enrich-batch.ts",
    builder: "buildFirstPassEnvelope",
    purpose: "First-pass zone enrichment for a batch of zones.",
  },
  {
    pkg: "sourcevision",
    file: "packages/sourcevision/src/analyzers/enrich-batch.ts",
    builder: "buildLaterPassEnvelope",
    purpose: "Later-pass zone enrichment, given the previous pass's output.",
  },
  {
    pkg: "sourcevision",
    file: "packages/sourcevision/src/analyzers/enrich-config.ts",
    builder: "buildMetaEnvelope",
    purpose: "Meta-evaluation choosing the enrichment strategy for a repo.",
  },
  {
    pkg: "sourcevision",
    file: "packages/sourcevision/src/analyzers/enrich-per-zone.ts",
    builder: "buildSingleZoneFirstPassEnvelope",
    purpose: "Per-zone enrichment, first pass — names and describes one zone.",
  },
  {
    pkg: "sourcevision",
    file: "packages/sourcevision/src/analyzers/enrich-per-zone.ts",
    builder: "buildSingleZoneLaterPassEnvelope",
    purpose: "Per-zone enrichment, later pass — adds only what pass 1 missed.",
  },
  {
    pkg: "sourcevision",
    file: "packages/sourcevision/src/analyzers/classify.ts",
    builder: "buildLLMClassifyEnvelope",
    purpose: "Classify file archetypes the heuristic classifier could not.",
  },
  {
    pkg: "sourcevision",
    file: "packages/sourcevision/src/analyzers/primer.ts",
    builder: "buildPrimerEnvelope",
    purpose: "Distil CONTEXT.md into the startup primer every agent run inherits.",
  },

  // ── hench ──────────────────────────────────────────────────────────────
  {
    pkg: "hench",
    file: "packages/hench/src/agent/planning/prompt.ts",
    builder: "buildSystemPrompt",
    purpose: "The agent's system prompt — role, rules, workflow, error handling.",
  },
  {
    pkg: "hench",
    file: "packages/hench/src/agent/planning/prompt.ts",
    builder: "buildGoLanguageContext",
    purpose: "Go toolchain and convention context, added when the project is Go.",
  },
  {
    pkg: "hench",
    file: "packages/hench/src/agent/planning/brief.ts",
    builder: "formatTaskBrief",
    purpose: "Render the task brief section — task, parent chain, requirements.",
  },
  {
    pkg: "hench",
    file: "packages/hench/src/agent/analysis/adversarial-review.ts",
    builder: "buildReviewSystemPrompt",
    purpose: "System prompt for the adversarial review pass.",
  },
  {
    pkg: "hench",
    file: "packages/hench/src/agent/analysis/adversarial-review.ts",
    builder: "buildReviewBrief",
    purpose: "Brief handed to the reviewer — what to attack and where to report.",
  },
  {
    pkg: "hench",
    file: "packages/hench/src/agent/lifecycle/orientation.ts",
    builder: "buildOrientationSystemPrompt",
    purpose: "System prompt for the one-off repository orientation pass.",
  },
  {
    pkg: "hench",
    file: "packages/hench/src/agent/lifecycle/orientation.ts",
    builder: "buildOrientationPrompt",
    purpose: "Orientation task prompt — what to establish about the repo.",
  },
  {
    pkg: "hench",
    file: "packages/hench/src/agent/lifecycle/cli-loop.ts",
    builder: "buildRetryNotice",
    purpose: "Notice appended on retry telling a fresh session what is on disk.",
  },
  {
    pkg: "hench",
    file: "packages/hench/src/agent/lifecycle/plan-mode-prompt.ts",
    builder: "formatPlanModeAppendix",
    purpose: "Appendix re-spawning a session that stalled in plan mode.",
  },

  // ── core ───────────────────────────────────────────────────────────────
  {
    pkg: "core",
    file: "packages/core/pair-programming.js",
    builder: "buildReviewerPrompt",
    purpose: "QA reviewer prompt for the pair-programming second opinion.",
  },
];

/**
 * Packages with no LLM prompt surfaces.
 *
 * Recorded so the absence is a finding rather than an oversight — a later
 * audit should be able to tell "we looked and there were none" apart from
 * "nobody looked". Enforced by tests/e2e/prompt-census.test.js.
 */
const NO_PROMPT_PACKAGES = {
  web: "Serves the dashboard and proxies MCP. Every LLM call it surfaces is made by rex, sourcevision, or hench behind a gateway; web composes no prompt text of its own.",
  "llm-client": "Foundation tier. Carries the prompt envelope and token types that the other packages fill in, but composes no prompt text itself.",
};

/**
 * Name patterns for interactive readline prompts — questions to a human, not
 * to a model. Explicitly out of scope for this epic.
 */
const INTERACTIVE_PROMPT_PATTERNS = [
  /^prompt[A-Z]/, //  promptUser, promptLine, promptRollbackConfirm, promptCommitConfirm, …
  /^confirmPrompt$/,
  /^defaultPrompt$/,
  /Prompt(Input|Choice|Confirm)$/,
];

/**
 * Builders whose name matches a prompt pattern but which are not LLM prompts.
 *
 * These are the false positives a name-based audit produces. Each one is
 * classified here once so it does not have to be re-investigated.
 */
const OUT_OF_SCOPE = [
  {
    file: "packages/rex/src/cli/commands/chunked-review-state.ts",
    builder: "buildPrompt",
    reason: "Readline prompt string (`(3/8 accepted) > `) passed to promptLine. Named buildPrompt but never reaches a model.",
  },
  {
    file: "packages/rex/src/cli/commands/smart-add.ts",
    builder: "parseDuplicatePromptInput",
    reason: "Parses a human's answer to a readline prompt.",
  },
  {
    file: "packages/hench/src/agent/analysis/review.ts",
    builder: "promptReview",
    reason: "Interactive review gate — asks the operator, not a model.",
  },
  {
    file: "packages/hench/src/agent/lifecycle/prompt-diagnostics.ts",
    builder: "extractPromptSectionDiagnostics",
    reason: "Measures a prompt envelope; emits no prompt text.",
  },
  {
    file: "packages/hench/src/agent/lifecycle/prompt-diagnostics.ts",
    builder: "logPromptSections",
    reason: "Logs envelope section sizes to the CLI.",
  },
  {
    file: "packages/hench/src/tools/test-command-resolver.ts",
    builder: "promptForTestCommand",
    reason: "Asks the operator for a test command.",
  },
];

// ── Static literal extraction ────────────────────────────────────────────────

/**
 * Extract the static prompt text a builder always emits.
 *
 * Walks the named function's body and collects every string literal. A
 * template literal contributes its static spans with the interpolations
 * removed (`${x}` costs nothing here — it is per-run context, counted under
 * `assembled` instead). Separate literals are joined with a newline, which is
 * how `lines.push(...)` assembly renders and close enough for template
 * literals that it does not distort a comparison run against the same rule.
 *
 * Module-level string constants the body references are resolved and counted
 * too, including ones imported from a sibling module (rex keeps `PRD_SCHEMA`
 * and `TASK_QUALITY_RULES` in `analyze-shared.ts` and interpolates them into
 * seven different builders). Without that step a builder like
 * `reasonForReshape`, whose entire prompt lives in four `const PROMPT = \`…\``
 * declarations and whose body only assembles them, measures at 57 characters —
 * a 25x undercount. Each constant is counted once per surface no matter how
 * many times it is referenced.
 *
 * Import following is one level deep. A constant re-exported through a chain
 * of two or more modules is not resolved; none exist today, and `--check`
 * plus the totals in the baseline make a new one visible as a sudden drop.
 *
 * Calls to module-local helpers are followed the same way, for the same
 * reason. When the envelope migration factored rex's thrice-duplicated
 * placement block into `placementContent()` and its three-way mode switch into
 * `reshapeRoleContent()`, the text those helpers emit — including the
 * `AUTO_PLACEMENT_INSTRUCTION` and three reshape-brief constants they
 * reference — vanished from the measurement even though every prompt was
 * byte-for-byte unchanged. That is the worst failure mode this tool has: a
 * refactor that improves the code silently shrinks the baseline, and the next
 * rewrite gets credited with a saving nobody made. Following local calls means
 * moving prompt text into a helper does not change what it costs.
 *
 * Two rules keep that from double-counting:
 *
 * 1. A helper's text is recorded as *shared*, not own — the same treatment a
 *    module constant gets. Each caller is charged the full cost per call, and
 *    the package's unique total counts it once, because a rewrite edits the
 *    helper once. `placementContent` is called by three builders.
 * 2. A helper that is itself a registered surface is skipped, because it is
 *    already measured under its own row. `buildSystemPrompt` calls
 *    `buildGoLanguageContext`, which the registry lists separately.
 *
 * Helper following is one level deep and cycle-guarded. A helper that calls a
 * second helper contributes only its own text; none do today.
 *
 * All branches count. A builder with `isCli ? A : B` emits only one of them per
 * run, but both are fixed text a rewrite can shorten, so both belong in the
 * baseline. This is why a `fixed` total can exceed the `assembled` length of
 * any single path — see `branchConditional` in the report.
 *
 * @returns {{ text: string, literals: number, constants: string[] } | null}
 *   null when the builder is not found.
 */
function extractStaticPromptText(
  ts,
  sourceText,
  fileName,
  builderName,
  options = {},
) {
  /** Builders in this file that the registry measures in their own right. */
  const registeredSurfaces = options.registeredSurfaces ?? new Set();

  const sf = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
  );

  const target = findFunctionBody(ts, sf, builderName);
  if (!target) return null;

  const moduleConstants = new Map([
    ...collectImportedStringConstants(ts, sf, fileName),
    ...collectModuleStringConstants(ts, sf), // local wins on a name collision
  ]);

  /** @type {string[]} */
  const parts = [];
  /** Constants are kept apart from body literals so the report can both charge
   *  each surface the full cost it pays per call AND deduplicate shared text
   *  when totalling a package. `PRD_SCHEMA` is interpolated into seven rex
   *  builders: each call pays for it, but a rewrite edits it once. */
  const pulledConstants = new Map();
  /** Local helpers already inlined — guards against recursion and re-counting. */
  const followedHelpers = new Set([builderName]);

  const visit = (node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      parts.push(node.text);
    } else if (ts.isTemplateExpression(node)) {
      // Static spans only — interpolations are per-run context.
      let joined = node.head.text;
      for (const span of node.templateSpans) joined += span.literal.text;
      parts.push(joined);
      // Descend into each interpolation — `${PRD_SCHEMA}` is a bare identifier
      // that must be visited itself, not just its children, and a ternary can
      // pick between two fixed sentences. Calling visit() rather than
      // forEachChild() is what makes `${CONST}` resolve.
      for (const span of node.templateSpans) visit(span.expression);
      return;
    } else if (
      ts.isIdentifier(node) &&
      moduleConstants.has(node.text) &&
      !pulledConstants.has(node.text) &&
      // Skip `obj.NAME` — only a bare value reference pulls the constant in.
      !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node)
    ) {
      pulledConstants.set(node.text, moduleConstants.get(node.text));
      return;
    } else if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      !followedHelpers.has(node.expression.text) &&
      !registeredSurfaces.has(node.expression.text) &&
      !pulledConstants.has(node.expression.text)
    ) {
      // Inline a module-local helper's prompt text, so factoring a duplicated
      // block out of three builders does not delete it from the measurement.
      const name = node.expression.text;
      const helper = findFunctionBody(ts, sf, name);
      if (helper) {
        followedHelpers.add(name);
        const helperParts = [];
        const helperConstants = new Map();
        collectInto(ts, sf, helper, helperParts, helperConstants, moduleConstants);
        // Recorded as shared, keyed by the helper's name: charged to every
        // caller per call, edited once. Its own constant references are folded
        // in so `placementContent` carries AUTO_PLACEMENT_INSTRUCTION with it.
        const helperText = [
          helperParts.join("\n"),
          [...helperConstants.values()].join("\n"),
        ].filter(Boolean).join("\n");
        if (helperText.length > 0) pulledConstants.set(name, helperText);
      }
      // Arguments may carry literals of their own (`section("role", "…")`).
      for (const arg of node.arguments) visit(arg);
      return;
    }
    ts.forEachChild(node, visit);
  };

  ts.forEachChild(target, visit);

  return {
    /** Literals written inside this builder — text only it can shorten. */
    ownText: parts.join("\n"),
    /** Shared constants it pulls in — name → text. */
    constants: pulledConstants,
    literals: parts.length,
  };
}

/**
 * Collect literals and referenced constants from one function body.
 *
 * The leaf walk, without helper following — used for the bodies of helpers that
 * a builder calls, so a helper contributes its own literals and the constants
 * it interpolates, but does not recurse further. That bound is what keeps
 * "one level deep" true for calls as well as imports.
 */
function collectInto(ts, sf, body, parts, constants, moduleConstants) {
  const visit = (node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      parts.push(node.text);
    } else if (ts.isTemplateExpression(node)) {
      let joined = node.head.text;
      for (const span of node.templateSpans) joined += span.literal.text;
      parts.push(joined);
      for (const span of node.templateSpans) visit(span.expression);
      return;
    } else if (
      ts.isIdentifier(node) &&
      moduleConstants.has(node.text) &&
      !constants.has(node.text) &&
      !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node)
    ) {
      constants.set(node.text, moduleConstants.get(node.text));
      return;
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(body, visit);
}

/**
 * Map every module-level `const NAME = <string literal>` in a file to its text.
 *
 * Only top-level declarations — a local `const` inside the builder is already
 * reached by the body walk, and resolving it here would double-count it.
 */
function collectModuleStringConstants(ts, sf) {
  const constants = new Map();

  for (const stmt of sf.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    for (const decl of stmt.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name) || !decl.initializer) continue;
      const init = decl.initializer;

      if (ts.isStringLiteral(init) || ts.isNoSubstitutionTemplateLiteral(init)) {
        constants.set(decl.name.text, init.text);
      } else if (ts.isTemplateExpression(init)) {
        let joined = init.head.text;
        for (const span of init.templateSpans) joined += span.literal.text;
        constants.set(decl.name.text, joined);
      }
    }
  }

  return constants;
}

/**
 * Resolve string constants this file imports by name from a sibling module.
 *
 * Only relative specifiers are followed, and only named imports — a prompt
 * constant reached through a package boundary would be a layering problem
 * worth failing on rather than quietly measuring. TS emits `./x.js` for
 * `./x.ts`, so the specifier is mapped back to source.
 */
function collectImportedStringConstants(ts, sf, fileName) {
  const resolved = new Map();

  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    const spec = stmt.moduleSpecifier.text;
    if (!spec.startsWith(".")) continue;

    const bindings = stmt.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;

    const source = join(dirname(fileName), spec.replace(/\.js$/, ".ts"));
    if (!existsSync(source)) continue;

    const sibling = ts.createSourceFile(
      source,
      readFileSync(source, "utf8"),
      ts.ScriptTarget.Latest,
      /* setParentNodes */ true,
    );
    const exported = collectModuleStringConstants(ts, sibling);

    for (const el of bindings.elements) {
      // `import { A as B }` — look up A, bind under the local name B.
      const original = (el.propertyName ?? el.name).text;
      if (exported.has(original)) resolved.set(el.name.text, exported.get(original));
    }
  }

  return resolved;
}

/** Find the body of a function declaration, arrow, or method by name. */
function findFunctionBody(ts, sf, name) {
  let found = null;

  const visit = (node) => {
    if (found) return;

    if (
      (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) &&
      node.name &&
      node.name.getText(sf) === name &&
      node.body
    ) {
      found = node.body;
      return;
    }

    if (
      ts.isVariableDeclaration(node) &&
      node.name &&
      ts.isIdentifier(node.name) &&
      node.name.text === name &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
    ) {
      found = node.initializer.body;
      return;
    }

    ts.forEachChild(node, visit);
  };

  visit(sf);
  return found;
}

// ── Representative inputs (the `--dump` fixtures) ────────────────────────────

/**
 * One assembled prompt per package, from a fixed input.
 *
 * These exist so the assembled number is reproducible: the same fixture in,
 * the same token count out, on any machine, with no model call. They import
 * from `dist/`, which the package guidelines permit for repo tooling.
 */
/**
 * Render an envelope as a dump entry: the assembled text plus its per-section
 * split.
 *
 * The package's own assembler is used rather than a join here, so the dumped
 * text is exactly what the package sends — a separator mismatch would make the
 * dump quietly disagree with production.
 *
 * @param {Record<string, Function>} mod - the package's prompt-envelope module
 * @param {{envelope: {sections: {name: string, content: string}[]}, assemble: string}} args
 */
function envelopeDump(mod, { envelope, assemble }) {
  return {
    text: mod[assemble](envelope),
    sections: envelope.sections.map((s) => ({
      name: s.name,
      chars: s.content.length,
    })),
  };
}

const REPRESENTATIVE = {
  rex: {
    // Names the registered *envelope* builder, not the `*Prompt` wrapper that
    // build() calls. The two emit identical text, but only the registered name
    // resolves against SURFACES below — and an unresolved name silently drops
    // this package's fixed/context split rather than erroring.
    surface: "buildAssessmentEnvelope",
    describe: "Granularity assessment over one two-task proposal.",
    async build() {
      const { buildAssessmentEnvelope } = await loadDist("rex/dist/analyze/reason.js");
      return envelopeDump(await loadDist("rex/dist/analyze/prompt-envelope.js"), {
        envelope: buildAssessmentEnvelope(FIXTURE_PROPOSALS),
        assemble: "rexPrompt",
      });
    },
  },
  sourcevision: {
    surface: "buildPrimerEnvelope",
    describe: "Primer distillation over a fixed 3-zone CONTEXT.md excerpt.",
    async build() {
      const { buildPrimerEnvelope } = await loadDist("sourcevision/dist/analyzers/primer.js");
      return envelopeDump(await loadDist("sourcevision/dist/analyzers/prompt-envelope.js"), {
        envelope: buildPrimerEnvelope(FIXTURE_CONTEXT_MD),
        assemble: "svPrompt",
      });
    },
  },
  hench: {
    surface: "buildPromptEnvelope",
    describe: "Full agent envelope (system + brief) for a CLI-provider run.",
    async build() {
      const { buildPromptEnvelope } = await loadDist("hench/dist/agent/planning/prompt.js");
      const { DEFAULT_HENCH_CONFIG } = await loadDist("hench/dist/schema/v1.js");
      const envelope = buildPromptEnvelope(FIXTURE_BRIEF, {
        ...DEFAULT_HENCH_CONFIG(),
        provider: "cli",
      });
      // Report per-section so the fragment-assembled prompt is not collapsed
      // into a single opaque number.
      return {
        text: envelope.sections.map((s) => s.content).join("\n\n"),
        sections: envelope.sections.map((s) => ({
          name: s.name,
          chars: s.content.length,
        })),
      };
    },
  },
  core: {
    surface: "buildReviewerPrompt",
    describe: "Pair-programming reviewer prompt over three changed files.",
    async build() {
      const { buildReviewerPrompt } = await loadDist("core/pair-programming.js");
      return buildReviewerPrompt({
        changedFiles: [
          "packages/rex/src/analyze/reason.ts",
          "packages/rex/tests/unit/analyze/reason.test.ts",
          "docs/analysis/prompt-token-baseline.md",
        ],
        testCommand: "pnpm test",
      });
    },
  },
};

const FIXTURE_PROPOSALS = [
  {
    epic: {
      title: "Agent Prompt & Workflow Efficiency",
      source: "sourcevision",
      description: "Audit and tighten every prompt surface that drives an LLM.",
    },
    features: [
      {
        title: "Prompt Token-Cost Baseline & Measurement",
        source: "sourcevision",
        description: "Record the token cost of every prompt surface before any rewrite.",
        tasks: [
          {
            title: "Inventory every LLM prompt surface",
            source: "sourcevision",
            sourceFile: "packages/rex/src/analyze/reason.ts",
            description: "List each builder with its file, purpose, and measured cost.",
            acceptanceCriteria: [
              "Every surface across rex, sourcevision, hench, and core is listed.",
              "Counts come from the existing llm-client token path.",
            ],
            priority: "high",
            tags: ["prompts", "tokens"],
          },
          {
            title: "Emit a before/after comparison",
            source: "sourcevision",
            sourceFile: "scripts/prompt-census.mjs",
            description: "Re-running the census after a rewrite reports the delta.",
            acceptanceCriteria: ["Comparison names the surfaces that moved."],
            priority: "medium",
            tags: ["prompts"],
          },
        ],
      },
    ],
  },
];

const FIXTURE_CONTEXT_MD = [
  "# Project Context",
  "",
  "## Overview",
  "TypeScript monorepo, 6 packages, pnpm workspaces. 744 production files.",
  "",
  "## Zones",
  "- `web-viewer` — 269 files, cohesion 0.92, coupling 0.08. Preact dashboard UI.",
  "- `rex-cli` — 170 files, cohesion 0.99, coupling 0.01. PRD command handlers.",
  "- `hench` — 108 files, cohesion 1.00, coupling 0.00. Agent loop and tool dispatch.",
  "",
  "## Entry points",
  "- `packages/core/cli.js` — the `n-dx` orchestrator.",
  "- `packages/web/src/server/start.ts` — dashboard server, port 3117.",
  "",
  "## Commands",
  "- Build: `pnpm build`",
  "- Test: `pnpm test`",
  "- Typecheck: `pnpm typecheck`",
].join("\n");

const FIXTURE_BRIEF = {
  project: {
    name: "n-dx",
    cliName: "n-dx",
    validateCommand: "pnpm typecheck",
    testCommand: "pnpm test",
  },
  task: {
    id: "00000000-0000-4000-8000-000000000000",
    title: "Prompt Token-Cost Baseline & Measurement",
    level: "feature",
    status: "pending",
    priority: "high",
    description:
      "Inventory every prompt surface that reaches an LLM and record its token cost before any rewriting.",
    acceptanceCriteria: [
      "A single checked-in inventory lists every LLM prompt surface with its measured token cost.",
      "Token counts come from the existing llm-client token path.",
      "Re-running the measurement emits a before-and-after comparison.",
    ],
    tags: ["prompts", "tokens", "measurement"],
  },
  parentChain: [
    {
      title: "Agent Prompt & Workflow Efficiency",
      level: "epic",
      description: "Audit and tighten every prompt surface that drives an LLM.",
    },
  ],
  requirements: [],
  siblings: [],
  recentLog: [],
};

/** Import a built module by workspace-relative path. */
/**
 * Measure every workflow skill body.
 *
 * Skills are prompts too — a skill body is pasted into the agent's context the
 * moment it is invoked, so a 20 KB skill is a 5,000-token bill on every run
 * that touches it. They were outside this census entirely, which meant the one
 * category of prompt text a contributor edits by hand most often was also the
 * only one with no number attached.
 *
 * Measured whole rather than per section: unlike the code builders there is no
 * conditional assembly to attribute: the body goes in as written.
 *
 * Both kinds are included. The ten in the manifest ship to other repositories
 * via `ndx init`; `iso-map`, `triage` and `dev-link` exist only here. Both cost
 * the same tokens when invoked, so both are counted, with `shipped` recording
 * which is which.
 */
async function measureSkills(model) {
  const { allSkills } = await import(
    pathToFileURL(join(ROOT, "tests/helpers/all-skills.js")).href
  );
  const { budgetPreflight } = await loadDist("llm-client/dist/budget-preflight.js");

  return allSkills()
    .map((s) => ({
      name: s.name,
      file: s.file,
      shipped: s.shipped,
      chars: s.body.length,
      tokens: budgetPreflight(model, s.body.length).tokenEstimate,
    }))
    .sort((a, b) => b.tokens - a.tokens);
}

async function loadDist(relative) {
  const abs = join(ROOT, "packages", relative);
  if (!existsSync(abs)) {
    throw new Error(
      `Missing build output: packages/${relative}\nRun \`pnpm build\` first — the census imports built prompt builders.`,
    );
  }
  return import(pathToFileURL(abs).href);
}

// ── Measurement ──────────────────────────────────────────────────────────────

async function measure(model) {
  const ts = require("typescript");
  const { budgetPreflight } = await loadDist("llm-client/dist/budget-preflight.js");

  const tokens = (text) => budgetPreflight(model, text.length).tokenEstimate;

  /**
   * Builders the registry measures in their own right, per file.
   *
   * Passed to the extractor so a call to one of them is not inlined into its
   * caller — `buildSystemPrompt` calls `buildGoLanguageContext`, and following
   * it would charge the Go context twice.
   */
  const registeredByFile = new Map();
  for (const s of SURFACES) {
    let set = registeredByFile.get(s.file);
    if (!set) { set = new Set(); registeredByFile.set(s.file, set); }
    set.add(s.builder);
  }
  const extractOptions = (file) => ({
    registeredSurfaces: registeredByFile.get(file) ?? new Set(),
  });

  const surfaces = SURFACES.map((s) => {
    const abs = join(ROOT, s.file);
    if (!existsSync(abs)) {
      return { ...s, error: "file not found" };
    }
    const extracted = extractStaticPromptText(
      ts,
      readFileSync(abs, "utf8"),
      abs,
      s.builder,
      extractOptions(s.file),
    );
    if (!extracted) {
      return { ...s, error: `builder \`${s.builder}\` not found in ${s.file}` };
    }
    const constantText = [...extracted.constants.values()].join("\n");
    const fullText = [extracted.ownText, constantText].filter(Boolean).join("\n");

    return {
      pkg: s.pkg,
      file: s.file,
      builder: s.builder,
      purpose: s.purpose,
      inline: s.inline === true,
      literals: extracted.literals,
      /** Shared constants this builder interpolates, name → token cost. */
      constants: Object.fromEntries(
        [...extracted.constants].map(([name, text]) => [name, tokens(text)]),
      ),
      /** Text only this builder can shorten. */
      ownTokens: tokens(extracted.ownText),
      /** What one call to this builder pays, shared constants included. */
      fixedChars: fullText.length,
      fixedTokens: tokens(fullText),
    };
  });

  // A constant interpolated into seven builders costs seven times per call but
  // is edited once. Both numbers matter, and reporting only the first would
  // point the rest of this epic at the wrong work.
  const constantTexts = new Map();
  for (const s of SURFACES) {
    const abs = join(ROOT, s.file);
    if (!existsSync(abs)) continue;
    const extracted = extractStaticPromptText(
      ts,
      readFileSync(abs, "utf8"),
      abs,
      s.builder,
      extractOptions(s.file),
    );
    if (!extracted) continue;
    for (const [name, text] of extracted.constants) {
      constantTexts.set(`${s.pkg}::${name}`, { pkg: s.pkg, name, text });
    }
  }

  const sharedConstants = [...constantTexts.values()]
    .map((c) => ({
      pkg: c.pkg,
      name: c.name,
      tokens: tokens(c.text),
      usedBy: surfaces.filter((s) => !s.error && c.name in s.constants).map((s) => s.builder),
    }))
    .sort((a, b) => b.tokens * b.usedBy.length - a.tokens * a.usedBy.length);

  const assembled = {};
  for (const [pkg, rep] of Object.entries(REPRESENTATIVE)) {
    try {
      const built = await rep.build();
      const text = typeof built === "string" ? built : built.text;
      assembled[pkg] = {
        surface: rep.surface,
        describe: rep.describe,
        chars: text.length,
        tokens: tokens(text),
        ...(typeof built === "object" && built.sections
          ? {
            sections: built.sections.map((sec) => ({
              ...sec,
              tokens: budgetPreflight(model, sec.chars).tokenEstimate,
            })),
          }
          : {}),
      };
    } catch (err) {
      assembled[pkg] = { surface: rep.surface, error: err.message };
    }
  }

  // Fixed text is the part a rewrite reduces; context is what the run supplies.
  // Attributing a reduction to the wrong one is the failure this split prevents.
  for (const [pkg, a] of Object.entries(assembled)) {
    if (a.error) continue;
    const surface = surfaces.find((s) => s.pkg === pkg && s.builder === a.surface);
    // hench's dump entry point composes other measured builders rather than
    // holding literals of its own, so sum the surfaces it delivers.
    const fixedTokens = surface
      ? surface.fixedTokens
      : pkg === "hench"
        ? sumFixed(surfaces, ["buildSystemPrompt", "formatTaskBrief"])
        : undefined;
    if (fixedTokens === undefined) continue;
    a.fixedTokens = fixedTokens;

    // `fixed` counts every branch; the assembled prompt took one path. When
    // fixed exceeds assembled the builder is branch-conditional and the
    // difference is unreached text, NOT negative context. Reported rather
    // than clamped to zero — clamping would quietly turn "half this builder
    // never runs on this path" into "this prompt carries no context".
    if (a.tokens >= fixedTokens) {
      a.contextTokens = a.tokens - fixedTokens;
    } else {
      a.branchConditional = true;
      a.unreachedTokens = fixedTokens - a.tokens;
    }
  }

  const byPackage = {};
  for (const s of surfaces) {
    if (s.error) continue;
    byPackage[s.pkg] ??= { surfaces: 0, perCallTokens: 0, uniqueTokens: 0 };
    byPackage[s.pkg].surfaces++;
    byPackage[s.pkg].perCallTokens += s.fixedTokens;
    byPackage[s.pkg].uniqueTokens += s.ownTokens;
  }
  // Add each shared constant to its package once — the edit surface, not the bill.
  for (const c of sharedConstants) {
    if (byPackage[c.pkg]) byPackage[c.pkg].uniqueTokens += c.tokens;
  }

  const skills = await measureSkills(model);

  return {
    model,
    totals: {
      surfaces: surfaces.filter((s) => !s.error).length,
      /** Sum of what every surface costs per call. Shared text counted per use. */
      perCallTokens: surfaces.reduce((n, s) => n + (s.fixedTokens ?? 0), 0),
      /** Distinct fixed prompt text in the repo. What a rewrite has to edit. */
      uniqueTokens: Object.values(byPackage).reduce((n, p) => n + p.uniqueTokens, 0),
      /** Skill bodies, counted separately — one is billed per invocation, not per call. */
      skills: skills.length,
      skillTokens: skills.reduce((n, s) => n + s.tokens, 0),
    },
    skills,
    byPackage,
    sharedConstants,
    surfaces,
    assembled,
    noPromptPackages: NO_PROMPT_PACKAGES,
    outOfScope: {
      namePatterns: INTERACTIVE_PROMPT_PATTERNS.map((r) => r.source),
      classified: OUT_OF_SCOPE,
    },
  };
}

function sumFixed(surfaces, builders) {
  return surfaces
    .filter((s) => builders.includes(s.builder) && !s.error)
    .reduce((n, s) => n + s.fixedTokens, 0);
}

// ── Reporting ────────────────────────────────────────────────────────────────

function pad(s, n) {
  return String(s).padEnd(n);
}
function padL(s, n) {
  return String(s).padStart(n);
}

function printTable(report) {
  const errors = report.surfaces.filter((s) => s.error);

  console.log(`\nPrompt token census — fixed prompt text at HEAD (model: ${report.model})\n`);
  console.log(
    `${pad("PACKAGE", 14)}${pad("BUILDER", 32)}${padL("LITERALS", 9)}${padL("OWN", 8)}${padL("SHARED", 8)}${padL("PER-CALL", 9)}`,
  );
  console.log("─".repeat(80));

  for (const pkg of Object.keys(report.byPackage)) {
    for (const s of report.surfaces.filter((x) => x.pkg === pkg && !x.error)) {
      const name = s.builder + (s.inline ? " *" : "");
      const shared = s.fixedTokens - s.ownTokens;
      console.log(
        `${pad(pkg, 14)}${pad(name, 32)}${padL(s.literals, 9)}${padL(s.ownTokens, 8)}${padL(shared || "—", 8)}${padL(s.fixedTokens, 9)}`,
      );
    }
    const p = report.byPackage[pkg];
    console.log(
      `${pad("", 14)}${pad(`  └ ${p.surfaces} surfaces, ${p.uniqueTokens} unique`, 32)}${padL("", 9)}${padL("", 8)}${padL("", 8)}${padL(p.perCallTokens, 9)}`,
    );
  }

  console.log("─".repeat(80));
  console.log(
    `${pad("TOTAL", 14)}${pad(`${report.totals.surfaces} surfaces`, 32)}${padL("", 9)}${padL("", 8)}${padL("", 8)}${padL(report.totals.perCallTokens, 9)}`,
  );
  console.log(
    `${pad("", 14)}${pad("unique fixed prompt text", 32)}${padL("", 9)}${padL("", 8)}${padL("", 8)}${padL(report.totals.uniqueTokens, 9)}`,
  );
  console.log("\n  * prompt is an inline template literal, not an extracted builder");
  console.log("  OWN = literals in this builder   SHARED = constants it interpolates");
  console.log("  PER-CALL = what one call pays    unique = distinct text a rewrite edits");

  if (report.sharedConstants.length > 0) {
    console.log("\nShared prompt constants (edit once, saves everywhere it is used):\n");
    for (const c of report.sharedConstants) {
      console.log(
        `  ${pad(c.name, 32)}${padL(c.tokens, 6)} tokens x ${c.usedBy.length} ` +
          `= ${c.tokens * c.usedBy.length} per-call tokens`,
      );
    }
  }

  console.log("\nAssembled prompts from fixed representative input:\n");
  for (const [pkg, a] of Object.entries(report.assembled)) {
    if (a.error) {
      console.log(`  ${pad(pkg, 14)} ${a.surface} — ERROR: ${a.error}`);
      continue;
    }
    const split = a.branchConditional
      ? `  (fixed ${a.fixedTokens} across all branches; ${a.unreachedTokens} not on this path)`
      : a.contextTokens === undefined
        ? ""
        : `  (fixed ${a.fixedTokens} + context ${a.contextTokens})`;
    console.log(`  ${pad(pkg, 14)} ${pad(a.surface, 24)} ${padL(a.tokens, 6)} tokens${split}`);
    for (const sec of a.sections ?? []) {
      console.log(`  ${pad("", 14)}   └ ${pad(sec.name, 22)} ${padL(sec.tokens, 6)} tokens`);
    }
  }

  console.log("\nPackages with no LLM prompt surfaces:");
  for (const [pkg, why] of Object.entries(report.noPromptPackages)) {
    console.log(`  ${pad(pkg, 14)} ${why}`);
  }

  if (errors.length > 0) {
    console.log("\nSTALE REGISTRY ENTRIES:");
    for (const e of errors) console.log(`  ${e.file} — ${e.error}`);
  }
  console.log("");
  return errors.length;
}

function printComparison(before, after) {
  const key = (s) => `${s.file}::${s.builder}`;
  const beforeMap = new Map(
    before.surfaces.filter((s) => !s.error).map((s) => [key(s), s]),
  );

  console.log(`\nPrompt token census — baseline vs HEAD\n`);
  console.log(`  baseline: ${before.recordedAt ?? "unknown"} @ ${before.commit ?? "unknown"}`);
  console.log(`  current:  HEAD (model: ${after.model})\n`);
  console.log(`${pad("BUILDER", 34)}${padL("BEFORE", 9)}${padL("AFTER", 9)}${padL("DELTA", 9)}`);
  console.log("─".repeat(61));

  let moved = 0;
  for (const s of after.surfaces) {
    if (s.error) continue;
    const prev = beforeMap.get(key(s));
    if (!prev) {
      console.log(`${pad(s.builder, 34)}${padL("—", 9)}${padL(s.fixedTokens, 9)}${padL("NEW", 9)}`);
      moved++;
      continue;
    }
    beforeMap.delete(key(s));
    const delta = s.fixedTokens - prev.fixedTokens;
    if (delta === 0) continue;
    moved++;
    const sign = delta > 0 ? `+${delta}` : String(delta);
    console.log(`${pad(s.builder, 34)}${padL(prev.fixedTokens, 9)}${padL(s.fixedTokens, 9)}${padL(sign, 9)}`);
  }

  for (const [, gone] of beforeMap) {
    moved++;
    console.log(`${pad(gone.builder, 34)}${padL(gone.fixedTokens, 9)}${padL("—", 9)}${padL("REMOVED", 9)}`);
  }

  if (moved === 0) console.log("  (no surface changed)");

  // Skills are listed separately because they are billed per invocation, not
  // per model call — folding them into the surface table would imply a total
  // that no single event ever costs.
  const beforeSkills = new Map((before.skills ?? []).map((s) => [s.name, s]));
  const skillRows = (after.skills ?? []).filter(
    (s) => (beforeSkills.get(s.name)?.tokens ?? null) !== s.tokens,
  );
  if (skillRows.length) {
    console.log("─".repeat(61));
    console.log(`${pad("SKILL", 34)}${padL("BEFORE", 9)}${padL("AFTER", 9)}${padL("DELTA", 9)}`);
    for (const s of skillRows) {
      const prev = beforeSkills.get(s.name);
      const b = prev?.tokens;
      const d = b === undefined ? "NEW" : `${s.tokens - b > 0 ? "+" : ""}${s.tokens - b}`;
      console.log(`${pad(s.name, 34)}${padL(b ?? "—", 9)}${padL(s.tokens, 9)}${padL(d, 9)}`);
    }
  }

  console.log("─".repeat(61));
  for (const [label, key] of [
    ["TOTAL per-call", "perCallTokens"],
    ["TOTAL unique fixed text", "uniqueTokens"],
    ["TOTAL skill bodies", "skillTokens"],
  ]) {
    const b = before.totals[key] ?? 0;
    const a = after.totals[key] ?? 0;
    const d = a - b;
    const pct = b ? `${((d / b) * 100).toFixed(1)}%` : "—";
    console.log(
      `${pad(label, 34)}${padL(b, 9)}${padL(a, 9)}${padL(`${d > 0 ? "+" : ""}${d}`, 9)}  ${pct}`,
    );
  }
  console.log("");
  return 0;
}

// ── Markdown inventory ───────────────────────────────────────────────────────

function renderMarkdown(report) {
  const lines = [];
  const n = (x) => x.toLocaleString("en-US");

  lines.push("<!-- GENERATED by `node scripts/prompt-census.mjs --write`. Do not edit by hand. -->");
  lines.push("");
  lines.push("# Prompt Token-Cost Baseline");
  lines.push("");
  lines.push(
    "Every prompt surface in the monorepo that reaches an LLM, with the token cost of",
  );
  lines.push(
    "the fixed text it always emits. This file is re-recorded as the",
  );
  lines.push(
    "*Agent Prompt & Workflow Efficiency* epic proceeds, so the figures below are current",
  );
  lines.push(
    "rather than original. The epic started from **22,670 per-call / 13,630 unique** at",
  );
  lines.push(
    "`2a64b185` — the last recording before any prompt was rewritten, and the number the",
  );
  lines.push(
    "epic's overall reduction should be measured against. Use `--compare` for the delta",
  );
  lines.push("since whatever is recorded here now.");
  lines.push("");
  lines.push(`- **Recorded at** — ${report.recordedAt}`);
  lines.push(`- **Commit** — \`${report.commit}\``);
  if (report.dirty) {
    lines.push(
      "- **Working tree was dirty** — these figures were measured from " +
        "uncommitted changes, so the commit above is where the tree was based, " +
        "not what produced these numbers. Re-record from a clean tree.",
    );
  }
  if (report.contentHash) {
    lines.push(
      `- **Content hash** — \`${report.contentHash}\` ` +
        "(identifies the measurement itself; `tests/e2e/prompt-census.test.js` " +
        "fails when the repo no longer matches it)",
    );
  }
  lines.push(`- **Model for cost/context figures** — \`${report.model}\``);
  lines.push(`- **Surfaces** — ${report.totals.surfaces}`);
  lines.push(
    `- **Per-call total** — ${n(report.totals.perCallTokens)} tokens (what every surface costs, summed)`,
  );
  lines.push(
    `- **Unique fixed text** — ${n(report.totals.uniqueTokens)} tokens (distinct text a rewrite has to edit)`,
  );
  lines.push("");
  lines.push("## How to reproduce");
  lines.push("");
  lines.push("```sh");
  lines.push("pnpm build                                    # the census imports built builders");
  lines.push("node scripts/prompt-census.mjs                # measure HEAD");
  lines.push("node scripts/prompt-census.mjs --compare      # before/after vs this file");
  lines.push("node scripts/prompt-census.mjs --dump hench   # print one assembled prompt");
  lines.push("node scripts/prompt-census.mjs --write        # re-record the baseline");
  lines.push("```");
  lines.push("");
  lines.push("## What the two numbers mean");
  lines.push("");
  lines.push(
    "**Fixed** is the prompt text a builder always emits, extracted from the string",
  );
  lines.push(
    "literals in its body. It is what a rewrite reduces. **Context** is what the run",
  );
  lines.push(
    "supplies — file lists, PRD items, analysis output — and it does not shrink because",
  );
  lines.push(
    "someone tightened a sentence. Keeping them apart is what stops a reduction being",
  );
  lines.push("credited to the wrong surface.");
  lines.push("");
  lines.push(
    "Counting literals rather than output is also what makes the three construction",
  );
  lines.push(
    "styles comparable. core writes a few large template literals per prompt; hench",
  );
  lines.push(
    "pushes dozens of short fragments onto an array; rex and sourcevision declare a",
  );
  lines.push(
    "list of named sections. A literal-per-file scan undercounts the last two badly;",
  );
  lines.push("counting literals per *builder* does not.");
  lines.push("");
  lines.push(
    "Token counts come from `budgetPreflight()` in `@n-dx/llm-client` — the same",
  );
  lines.push(
    "estimator the runtime uses for context-window preflight, so a number here is the",
  );
  lines.push("number the runtime would produce for the same text.");
  lines.push("");
  lines.push("## Per-call vs unique");
  lines.push("");
  lines.push(
    "**Own** is the text written inside a builder. **Shared** is the prompt constants it",
  );
  lines.push(
    "interpolates — `PRD_SCHEMA`, `FEW_SHOT_EXAMPLE` and friends, which rex reuses across",
  );
  lines.push("many builders. **Per-call** is their sum: what one invocation actually sends.");
  lines.push("");
  lines.push(
    "The two totals answer different questions. Per-call is the bill. Unique is the edit",
  );
  lines.push(
    "surface — a constant used by ten builders is written once, so shortening it is worth",
  );
  lines.push(
    "ten times its own size. Reporting only the per-call sum would point a rewrite at the",
  );
  lines.push("largest builders rather than at the most-reused text.");
  lines.push("");
  lines.push("## Measurement revisions");
  lines.push("");
  lines.push(
    "A total in this file can move because prompts changed or because the *measurement*",
  );
  lines.push(
    "changed. Only the first is a result. Revisions of the second kind are recorded here",
  );
  lines.push("so a jump is never mistaken for a regression or a win.");
  lines.push("");
  lines.push(
    "- **Envelope migration** — rex's and sourcevision's prompts moved onto",
  );
  lines.push(
    "  `PromptEnvelope`, and every builder was renamed `*Prompt` → `*Envelope`, so a",
  );
  lines.push(
    "  `--compare` across that change shows the whole registry as NEW/REMOVED. The",
  );
  lines.push(
    "  assembled text is byte-identical apart from removed doubled blank lines, proved by",
  );
  lines.push(
    "  the `prompt-text-identity` snapshot suites in both packages. In the same change the",
  );
  lines.push(
    "  extractor learned to follow module-local helper calls: factoring duplicated prompt",
  );
  lines.push(
    "  text into a helper had been dropping it from the count entirely. That correction",
  );
  lines.push(
    "  *raised* the recorded totals by ~5% with no prompt growing — the earlier figures",
  );
  lines.push("  were an undercount.");
  lines.push(
    "- **rex redundancy pass** — the first entry here that is a real reduction rather than",
  );
  lines.push(
    "  a measurement change: -904 per-call / -278 unique, by deleting instructions that the",
  );
  lines.push(
    "  same prompt already gave elsewhere and resolving a task-size contradiction (hours vs",
  );
  lines.push(
    "  engineer-weeks). No instruction was removed from a prompt that did not still state it.",
  );
  lines.push("");

  for (const pkg of Object.keys(report.byPackage)) {
    const p = report.byPackage[pkg];
    lines.push(
      `## ${pkg} — ${n(p.perCallTokens)} per-call / ${n(p.uniqueTokens)} unique, ${p.surfaces} surfaces`,
    );
    lines.push("");
    lines.push("| Builder | File | Purpose | Literals | Own | Shared | Per-call |");
    lines.push("|---|---|---|---:|---:|---:|---:|");
    for (const s of report.surfaces.filter((x) => x.pkg === pkg && !x.error)) {
      const name = s.inline ? `\`${s.builder}\` *(inline)*` : `\`${s.builder}\``;
      const shared = s.fixedTokens - s.ownTokens;
      lines.push(
        `| ${name} | \`${s.file}\` | ${s.purpose} | ${s.literals} | ${n(s.ownTokens)} | ${shared ? n(shared) : "—"} | ${n(s.fixedTokens)} |`,
      );
    }
    lines.push("");
  }

  if (report.sharedConstants.length > 0) {
    lines.push("## Shared prompt constants");
    lines.push("");
    lines.push(
      "Ranked by total per-call cost — size times the number of builders that interpolate",
    );
    lines.push("it. This is the leverage ordering for a rewrite.");
    lines.push("");
    lines.push("| Constant | Package | Tokens | Used by | Per-call total |");
    lines.push("|---|---|---:|---:|---:|");
    for (const c of report.sharedConstants) {
      lines.push(
        `| \`${c.name}\` | ${c.pkg} | ${n(c.tokens)} | ${c.usedBy.length} | ${n(c.tokens * c.usedBy.length)} |`,
      );
    }
    lines.push("");
  }

  lines.push("## Assembled prompts (fixed representative input)");
  lines.push("");
  lines.push(
    "One entry point per package, invoked with a checked-in fixture so the number is",
  );
  lines.push("reproducible without a model call. Dump any of them with `--dump <package>`.");
  lines.push("");
  lines.push("| Package | Entry point | Input | Fixed | Context | Assembled |");
  lines.push("|---|---|---|---:|---:|---:|");
  for (const [pkg, a] of Object.entries(report.assembled)) {
    if (a.error) {
      lines.push(`| ${pkg} | \`${a.surface}\` | — | — | — | **error: ${a.error}** |`);
      continue;
    }
    const context = a.branchConditional
      ? `n/a — ${n(a.unreachedTokens)} of the fixed text is on another branch`
      : n(a.contextTokens ?? 0);
    lines.push(
      `| ${pkg} | \`${a.surface}\` | ${a.describe} | ${n(a.fixedTokens ?? 0)} | ${context} | ${n(a.tokens)} |`,
    );
  }
  lines.push("");
  lines.push(
    "A `fixed` figure above the assembled length is not an error: the fixed column counts",
  );
  lines.push(
    "every branch in the builder, and one run takes one path. `buildSystemPrompt` alone",
  );
  lines.push(
    "carries separate CLI/API, auto-commit, and self-heal branches. The unreached text is",
  );
  lines.push("still worth shortening — it just is not billed on this particular path.");
  lines.push("");

  // Per-section cost for every envelope-built package. This is the table a
  // rewrite reads first: it is the only place that says which *part* of a
  // prompt carries the bill, so the largest section can be opened first
  // instead of the largest builder.
  for (const [pkg, a] of Object.entries(report.assembled)) {
    if (!a?.sections) continue;
    lines.push(`### ${pkg} envelope sections`);
    lines.push("");
    lines.push(
      `\`${a.surface}\` assembles its prompt from named sections, so its cost is reported`,
    );
    lines.push(
      "per section rather than as one literal. These are the same sections",
    );
    lines.push(
      "`extractPromptSectionDiagnostics()` reports at runtime, over the fixture in",
    );
    lines.push(`*${a.describe}*`);
    lines.push("");
    lines.push("| Section | Chars | Tokens | Share |");
    lines.push("|---|---:|---:|---:|");
    const total = a.sections.reduce((sum, s) => sum + s.tokens, 0) || 1;
    for (const s of [...a.sections].sort((x, y) => y.tokens - x.tokens)) {
      const share = ((s.tokens / total) * 100).toFixed(1);
      lines.push(`| \`${s.name}\` | ${n(s.chars)} | ${n(s.tokens)} | ${share}% |`);
    }
    lines.push("");
  }

  if (report.skills?.length) {
    lines.push(
      `## Workflow skills — ${n(report.totals.skillTokens)} tokens, ${report.skills.length} skills`,
    );
    lines.push("");
    lines.push(
      "A skill body enters the agent's context whole the moment the skill is invoked,",
    );
    lines.push(
      "so its size is a per-invocation bill in the same way a builder's fixed text is a",
    );
    lines.push(
      "per-call one. The two totals are NOT added together: a skill run and an analyze",
    );
    lines.push("call are different events.");
    lines.push("");
    lines.push(
      "`shipped` marks the skills `ndx init` installs into other repositories. The rest",
    );
    lines.push(
      "exist only here, which makes them easy to forget — they were exempt from the",
    );
    lines.push("portability guards until this table gave them a number.");
    lines.push("");
    lines.push("| Skill | Shipped | Chars | Tokens |");
    lines.push("|---|:-:|---:|---:|");
    for (const s of report.skills) {
      lines.push(
        `| \`${s.name}\` | ${s.shipped ? "yes" : "—"} | ${n(s.chars)} | ${n(s.tokens)} |`,
      );
    }
    lines.push("");
  }

  lines.push("## Packages with no LLM prompt surfaces");
  lines.push("");
  lines.push(
    "Recorded so the absence is a finding rather than an oversight — these were checked.",
  );
  lines.push("");
  lines.push("| Package | Why |");
  lines.push("|---|---|");
  for (const [pkg, why] of Object.entries(report.noPromptPackages)) {
    lines.push(`| ${pkg} | ${why} |`);
  }
  lines.push("");

  lines.push("## Out of scope: interactive readline prompts");
  lines.push("");
  lines.push(
    "These are questions to a human, not to a model. They are listed by name pattern so",
  );
  lines.push("a later audit does not mistake one for an LLM prompt surface.");
  lines.push("");
  lines.push("Name patterns:");
  lines.push("");
  for (const p of report.outOfScope.namePatterns) {
    lines.push(`- \`/${p}/\``);
  }
  lines.push("");
  lines.push(
    "Specific builders whose names match a prompt pattern but which are not LLM prompts:",
  );
  lines.push("");
  lines.push("| Builder | File | Why it is out of scope |");
  lines.push("|---|---|---|");
  for (const o of report.outOfScope.classified) {
    lines.push(`| \`${o.builder}\` | \`${o.file}\` | ${o.reason} |`);
  }
  lines.push("");

  return lines.join("\n");
}

// ── Provenance ───────────────────────────────────────────────────────────────

/**
 * Whether the working tree matches HEAD.
 *
 * ## Why this exists
 *
 * A recorded baseline is only worth keeping if it says which code produced its
 * numbers. `currentCommit()` reads `.git/HEAD`, which reports the commit the
 * tree is *based on* — not whether the files actually measured still match it.
 * So `--write` from a dirty tree measured the working tree and stamped HEAD,
 * and the two disagreed with nothing to notice.
 *
 * That is not hypothetical. The checked-in baseline named `3dda8b5b` while
 * containing `JSON_OBJECT_ONLY`, a constant introduced by `0b57e2eb` — a
 * *descendant* of the commit it claimed. `--compare` consequently reported
 * "(no surface changed)" across a range that had changed a prompt.
 *
 * ## Why a subprocess
 *
 * Answering "does the tree match HEAD?" from `.git/` alone means reading the
 * index, inflating loose objects, and walking packfiles — reimplementing git.
 * The mtime shortcut (compare each measured file against `.git/index`) is
 * guesswork that reports clean after a `touch`. Since a false *clean* is the
 * exact failure being fixed, neither is acceptable, so this script joins the
 * "Development scripts" entries already in the ALLOWED set of
 * tests/e2e/architecture-policy.test.js.
 *
 * ## Scope, and why it is deliberately broad
 *
 * Any dirty path counts, not only the measured ones. An unrelated edit will
 * therefore block a recording, which `--allow-dirty` exists to escape. The
 * trade is intentional: this can report dirty when the measurement would in
 * fact have been faithful, but it can never report clean when it would not.
 *
 * @returns `{ dirty }` — `dirty: true` when the tree differs from HEAD or the
 *   state could not be established at all. Never optimistic.
 */
function treeState() {
  try {
    const out = execFileSync("git", ["status", "--porcelain"], {
      cwd: ROOT,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return { dirty: out.trim().length > 0 };
  } catch {
    // No git, not a repo, or git failed. "Unknown" is treated as dirty: a
    // stamp that might be wrong must not be presented as though it is right.
    return { dirty: true };
  }
}

/**
 * Hash the measurement itself, so provenance does not depend on git at all.
 *
 * Two jobs. It gives the recording an identity that cannot disagree with its
 * own contents, and it is the staleness signal: when a prompt or skill body
 * changes without the baseline being re-recorded, this moves and
 * tests/e2e/prompt-census.test.js fails.
 *
 * Deliberately *not* a commit-equality check. Recording the baseline dirties
 * the baseline files, so committing them puts HEAD one commit ahead of the
 * stamp — a "stamp must equal HEAD" assertion would fail immediately after
 * every legitimate re-record. Hashing content sidesteps that: it only moves
 * when the numbers move.
 *
 * Only the fields a rewrite could change are hashed. `recordedAt` and the
 * model id are excluded, so re-recording an unchanged repo is idempotent.
 */
function contentHash(report) {
  const canonical = {
    surfaces: report.surfaces
      .map((s) => [s.file, s.builder, s.fixedChars ?? null, s.fixedTokens ?? null])
      .sort((a, b) => `${a[0]}${a[1]}`.localeCompare(`${b[0]}${b[1]}`)),
    skills: report.skills
      .map((s) => [s.name, s.chars, s.tokens])
      .sort((a, b) => a[0].localeCompare(b[0])),
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex").slice(0, 16);
}

// ── Entry point ──────────────────────────────────────────────────────────────

/**
 * Read the current commit from `.git` directly.
 *
 * Still not `git rev-parse` — reading the ref is exact and needs no subprocess.
 * What a `.git/` read cannot tell you is whether the *working tree* matches
 * that commit, which is the question {@link treeState} exists to answer.
 */
function currentCommit() {
  const head = readGitFile(".git/HEAD");
  if (!head) return "unknown";

  const ref = /^ref:\s*(.+)$/.exec(head);
  if (!ref) return head.slice(0, 12); // detached HEAD holds the sha directly

  const loose = readGitFile(join(".git", ref[1]));
  if (loose) return loose.slice(0, 12);

  // Ref has been packed — scan packed-refs for it.
  const packed = readGitFile(".git/packed-refs") ?? "";
  for (const line of packed.split("\n")) {
    const [sha, name] = line.trim().split(/\s+/);
    if (name === ref[1]) return sha.slice(0, 12);
  }
  return "unknown";
}

/** Read a file under .git, or null when it is absent (e.g. a tarball checkout). */
function readGitFile(relative) {
  const abs = join(ROOT, relative);
  return existsSync(abs) ? readFileSync(abs, "utf8").trim() : null;
}

async function main(argv) {
  const flag = (name) => argv.includes(`--${name}`);
  const value = (name) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };

  if (flag("help") || flag("h")) {
    console.log(
      [
        "Usage: node scripts/prompt-census.mjs [options]",
        "",
        "  (no options)      measure HEAD and print the table",
        "  --json            emit the full report as JSON",
        "  --compare         diff HEAD against docs/analysis/prompt-token-baseline.json",
        "  --baseline <path> compare against a different recording instead",
        "  --write           rewrite the checked-in baseline (.md and .json)",
        "                    refused on a dirty tree: the census measures the",
        "                    tree but stamps HEAD, so they must agree",
        "  --allow-dirty     record anyway; the stamp is marked `<sha>-dirty`",
        "  --out <path>      write the recording to <path> instead (.md alongside)",
        "  --dump <pkg>      print the assembled representative prompt for a package",
        "  --check           exit 1 if any registry entry no longer resolves",
        "  --model <id>      model used for the token estimate (default: claude-sonnet-5)",
        "",
        `  packages with a --dump fixture: ${Object.keys(REPRESENTATIVE).join(", ")}`,
      ].join("\n"),
    );
    return 0;
  }

  const model = value("model") ?? "claude-sonnet-5";

  const dumpPkg = value("dump");
  if (dumpPkg !== undefined) {
    const rep = REPRESENTATIVE[dumpPkg];
    if (!rep) {
      console.error(
        `Unknown package "${dumpPkg}". Available: ${Object.keys(REPRESENTATIVE).join(", ")}`,
      );
      return 1;
    }
    const { budgetPreflight } = await loadDist("llm-client/dist/budget-preflight.js");
    const built = await rep.build();
    const text = typeof built === "string" ? built : built.text;
    console.error(
      `── ${dumpPkg}/${rep.surface} — ${text.length} chars, ` +
        `${budgetPreflight(model, text.length).tokenEstimate} tokens (${rep.describe})`,
    );
    console.error("─".repeat(78));
    // Prompt body on stdout so it can be redirected or diffed on its own.
    console.log(text);
    return 0;
  }

  const report = await measure(model);
  // Attached to the report rather than only to a recording, so `--json` and
  // `--compare` expose the same identity a baseline was stamped with. The
  // staleness test compares a fresh `--json` hash against the recorded one, so
  // computing this only inside `--write` would leave it permanently undefined
  // on one side of that comparison.
  report.contentHash = contentHash(report);
  const stale = report.surfaces.filter((s) => s.error);

  if (flag("check")) {
    if (stale.length === 0) {
      console.log(`prompt census: ${report.totals.surfaces} surfaces resolve.`);
      return 0;
    }
    console.error("prompt census: stale registry entries in scripts/prompt-census.mjs\n");
    for (const s of stale) console.error(`  ${s.file} — ${s.error}`);
    return 1;
  }

  if (flag("json")) {
    console.log(JSON.stringify(report, null, 2));
    return stale.length > 0 ? 1 : 0;
  }

  if (flag("compare")) {
    const baselinePath = value("baseline") ?? BASELINE_JSON;
    if (!existsSync(baselinePath)) {
      console.error(
        `No baseline at ${baselinePath}.\nRun \`node scripts/prompt-census.mjs --write\` to record one first.`,
      );
      return 1;
    }
    return printComparison(JSON.parse(readFileSync(baselinePath, "utf8")), report);
  }

  if (flag("write")) {
    if (stale.length > 0) {
      console.error("Refusing to record a baseline with stale registry entries:\n");
      for (const s of stale) console.error(`  ${s.file} — ${s.error}`);
      return 1;
    }

    // A recording measures the working tree but stamps a commit, so the two
    // agree only when the tree is clean. Refuse rather than publish a stamp
    // that names code the numbers did not come from.
    const { dirty } = treeState();
    if (dirty && !flag("allow-dirty")) {
      console.error(
        [
          "Refusing to record a baseline from a dirty working tree.",
          "",
          "The census measures the tree but stamps HEAD, so a recording made",
          "now would attribute its numbers to a commit that does not contain",
          "them — which is how the previous baseline came to name a commit",
          "predating the code it measured.",
          "",
          "Commit or stash first, or pass --allow-dirty to record anyway (the",
          "stamp is then marked, not silently wrong).",
        ].join("\n"),
      );
      return 1;
    }

    const sha = currentCommit();
    const stamped = {
      ...report,
      recordedAt: new Date().toISOString(),
      // Suffixed rather than omitted: a reader looking for provenance finds
      // something, and it cannot be mistaken for a clean recording.
      commit: dirty ? `${sha}-dirty` : sha,
      dirty,
    };

    // --out redirects the write so tests can exercise recording without
    // rewriting the published artifact.
    const outJson = value("out") ?? BASELINE_JSON;
    const outMd = outJson === BASELINE_JSON ? BASELINE_MD : outJson.replace(/\.json$/, ".md");

    writeFileSync(outJson, `${JSON.stringify(stamped, null, 2)}\n`);
    writeFileSync(outMd, `${renderMarkdown(stamped)}\n`);
    console.log(
      `Wrote ${report.totals.surfaces} surfaces — ` +
        `${report.totals.perCallTokens.toLocaleString("en-US")} per-call, ` +
        `${report.totals.uniqueTokens.toLocaleString("en-US")} unique fixed tokens` +
        (dirty ? " (DIRTY TREE — stamp marked)" : ""),
    );
    console.log(`  ${outMd}`);
    console.log(`  ${outJson}`);
    return 0;
  }

  return printTable(report) > 0 ? 1 : 0;
}

// Run only when invoked as a command — tests/e2e/prompt-census.test.js imports
// the registry from this module and must not trigger a measurement pass.
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  process.exitCode = await main(process.argv.slice(2));
}

export {
  SURFACES,
  NO_PROMPT_PACKAGES,
  INTERACTIVE_PROMPT_PATTERNS,
  OUT_OF_SCOPE,
  REPRESENTATIVE,
  extractStaticPromptText,
  contentHash,
};
