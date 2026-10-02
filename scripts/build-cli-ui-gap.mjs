#!/usr/bin/env node
/**
 * Regenerate the "Command effects" section of `docs/cli-ui-gap.md` from core's
 * command manifest — the help registry (`packages/core/help.js`) for the list
 * of commands, and `packages/core/command-effects.js` for what each declares.
 *
 * Only the section between the BEGIN/END markers is generated; the rest of the
 * page is the hand-written coverage audit. A command in the registry with no
 * declaration renders as **undeclared**, which
 * `tests/e2e/cli-ui-gap-drift.test.js` refuses, so the doc cannot claim
 * coverage the manifest does not have.
 *
 *   node scripts/build-cli-ui-gap.mjs           # rewrite the section
 *   node scripts/build-cli-ui-gap.mjs --check   # fail if the committed doc is stale
 */

import { readFileSync, writeFileSync, realpathSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getOrchestratorCommands } from "../packages/core/help.js";
import { COMMAND_EFFECTS, LAYOUT_TOKENS } from "../packages/core/command-effects.js";
import { resolveLayout, relativeToRoot } from "../packages/core/layout.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const DOC_PATH = join(ROOT, "docs/cli-ui-gap.md");

export const BEGIN_MARKER = "<!-- BEGIN GENERATED: command-effects (scripts/build-cli-ui-gap.mjs) -->";
export const END_MARKER = "<!-- END GENERATED: command-effects -->";

/** The cell text a command without a declaration gets. */
export const UNDECLARED = "**undeclared**";

/** Escape the one character that breaks a Markdown table cell. */
function cell(text) {
  return String(text).replace(/\|/g, "\\|").replace(/\n/g, " ");
}

/** "`{rex}` = `.rex` (`.ndx/rex` on the .ndx layout), …" — from the resolver, not restated here. */
function tokenLegend() {
  const legacy = resolveLayout(ROOT, { mode: "legacy" });
  const ndx = resolveLayout(ROOT, { mode: "ndx" });
  return Object.entries(LAYOUT_TOKENS)
    .map(([token, field]) =>
      `\`{${token}}\` = \`${relativeToRoot(legacy, legacy[field])}\` (\`${relativeToRoot(ndx, ndx[field])}\` on the .ndx layout)`)
    .join(", ");
}

/** A real path gets code formatting; a description ("source files", "git commits") does not. */
function formatPath(path) {
  return /^[.~<{]|^[\w.-]+\//.test(path) ? `\`${path}\`` : path;
}

function formatWrites(effects) {
  if (effects.writes.length === 0) return "nothing (read-only)";
  return effects.writes
    .map((w) => `${formatPath(w.path)}${w.conditional ? ` (only ${w.when})` : ""}`)
    .join("<br>");
}

function formatLlm(effects) {
  if (effects.llm.length === 0) return "none";
  const phases = effects.llm.map((p) => `${p.phase} ~${p.calls}`);
  if (effects.noLlmFlags?.length) phases.push(`_none with ${effects.noLlmFlags.map((f) => `\`${f}\``).join(" or ")}_`);
  return phases.join("<br>");
}

function formatNetwork(effects) {
  if (effects.network.length === 0) return "none";
  return effects.network.map((n) => `${n.to}${n.when ? ` (only ${n.when})` : ""}`).join("<br>");
}

/** The generated section body, markers included. */
export function renderCommandEffectsSection(
  commands = getOrchestratorCommands(),
  effectsMap = COMMAND_EFFECTS,
) {
  const lines = [
    BEGIN_MARKER,
    "",
    "## Command effects",
    "",
    "_Generated from `packages/core/command-effects.js` — the same declarations the terminal preflight banner prints and `GET /api/commands/manifest` serves. Edit the declarations, then run `node scripts/build-cli-ui-gap.mjs`._",
    "",
    `Paths the layout owns are written as tokens: ${tokenLegend()}.`,
    "",
    "| Command | Writes | LLM phases (calls) | Network | Takes |",
    "|---------|--------|--------------------|---------|-------|",
  ];
  for (const name of commands) {
    const effects = effectsMap[name];
    if (!effects) {
      lines.push(`| \`ndx ${name}\` | ${UNDECLARED} | ${UNDECLARED} | ${UNDECLARED} | ${UNDECLARED} |`);
      continue;
    }
    lines.push(
      `| \`ndx ${name}\` | ${cell(formatWrites(effects))} | ${cell(formatLlm(effects))} | ${cell(formatNetwork(effects))} | ${cell(effects.duration)} |`,
    );
  }
  lines.push("", END_MARKER);
  return lines.join("\n");
}

/** `doc` with its generated section replaced. Throws when the markers are missing. */
export function buildCliUiGap(doc = readFileSync(DOC_PATH, "utf-8")) {
  const start = doc.indexOf(BEGIN_MARKER);
  const end = doc.indexOf(END_MARKER);
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`${DOC_PATH} is missing the generated-section markers:\n  ${BEGIN_MARKER}\n  ${END_MARKER}`);
  }
  return doc.slice(0, start) + renderCommandEffectsSection() + doc.slice(end + END_MARKER.length);
}

function isMain() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

if (isMain()) {
  const current = readFileSync(DOC_PATH, "utf-8");
  const next = buildCliUiGap(current);
  if (process.argv.includes("--check")) {
    if (next !== current) {
      console.error("docs/cli-ui-gap.md is stale. Run: node scripts/build-cli-ui-gap.mjs");
      process.exitCode = 1;
    }
  } else if (next !== current) {
    writeFileSync(DOC_PATH, next);
    console.log("Updated docs/cli-ui-gap.md");
  } else {
    console.log("docs/cli-ui-gap.md is up to date");
  }
}
