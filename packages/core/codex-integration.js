/**
 * Codex integration — auto-configures MCP servers and skills when `ndx init`
 * is run.
 *
 * This module is called by cli.js during init (unless --no-codex is passed).
 * It writes:
 *   1. `AGENTS.md` — project instructions generated from the assistant asset layer
 *   2. `.codex/config.toml` — stdio MCP server definitions for Rex and SourceVision
 *   3. `.agents/skills/` — workflow skill files (overwritten on each init)
 *
 * Skill content is sourced from `assistant-assets/` — the vendor-neutral
 * canonical location.  Skill writing is delegated to the shared
 * `writeVendorSkills()` function so Claude and Codex use the same
 * generation path.
 *
 * @module n-dx/codex-integration
 */

import { existsSync, mkdirSync, writeFileSync } from "fs";
import { createRequire } from "module";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import {
  getSkillNames,
  getMcpServers,
  writeVendorSkills,
  renderCodexConfigToml,
  renderAgentsMd,
} from "./assistant-assets.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const _require = createRequire(import.meta.url);

/**
 * Resolve a sub-package CLI path — monorepo first, then node_modules.
 */
function resolveSubPackageCli(pkgDir, npmName) {
  const monoPath = resolve(__dir, pkgDir, "dist/cli/index.js");
  if (existsSync(monoPath)) return monoPath;
  try {
    return _require.resolve(npmName + "/dist/cli/index.js");
  } catch {
    return monoPath; // fallback — will fail with a clear error
  }
}

// ── Config generation ──────────────────────────────────────────────────────────

/**
 * Write `.codex/config.toml` with stdio MCP server definitions.
 *
 * The generated file contains only MCP server definitions (no sandbox,
 * approval, or model configuration).  This matches the locked decision
 * in docs/process/codex-transport-artifact-decisions.md §5.
 *
 * @param {string} dir  Absolute project root directory
 * @returns {{ written: boolean, path: string, serverCount: number }}
 */
function writeCodexConfig(dir) {
  const codexDir = join(dir, ".codex");
  mkdirSync(codexDir, { recursive: true });

  const configPath = join(codexDir, "config.toml");
  const content = renderCodexConfigToml(dir, resolveSubPackageCli);
  writeFileSync(configPath, content);

  return {
    written: true,
    path: configPath,
    serverCount: Object.keys(getMcpServers()).length,
  };
}

// ── AGENTS.md writing ───────────────────────────────────────────────────────────

/**
 * Write `AGENTS.md` to the project root.
 *
 * The content is generated from the shared assistant asset layer so that it
 * stays in sync with the manifest's skill and MCP definitions automatically.
 *
 * @param {string} dir  Absolute project root directory
 * @returns {{ written: boolean, path: string }}
 */
function writeAgentsMd(dir) {
  const agentsPath = join(dir, "AGENTS.md");
  const content = renderAgentsMd();
  writeFileSync(agentsPath, content);
  return { written: true, path: agentsPath };
}

// ── Skill writing ──────────────────────────────────────────────────────────────

/**
 * Write all skill files via the canonical vendor-neutral writer.
 *
 * Unlike Claude's `writeSkills()`, Codex has no legacy layouts to clean up
 * since this is the first implementation.
 */
function writeSkills(dir) {
  return writeVendorSkills("codex", dir);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Run the full Codex integration setup.
 *
 * @param {string} dir  Project root directory
 * @returns {{ config: object, skills: object, agents: object }}
 */
export function setupCodexIntegration(dir) {
  const absDir = resolve(dir);

  const config = writeCodexConfig(absDir);
  const skills = writeSkills(absDir);
  const agents = writeAgentsMd(absDir);

  return { config, skills, agents };
}

/**
 * Print a summary of what was configured.
 *
 * @deprecated Use `formatInitReport()` from `assistant-integration.js` instead.
 * This function is retained for backward compatibility with external callers
 * and will be removed in a future major release.
 */
export function printCodexSetupSummary(result) {
  console.log("");
  console.log("Codex integration:");

  // AGENTS.md
  if (result.agents && result.agents.written) {
    console.log("  AGENTS.md: wrote project instructions");
  }

  // Config
  if (result.config.written) {
    console.log(`  Config: wrote .codex/config.toml (${result.config.serverCount} MCP servers, stdio transport)`);
  }

  // Skills
  const skillList = getSkillNames().map((n) => `/${n}`).join(", ");
  console.log(`  Skills: wrote ${result.skills.written} workflow skills (${skillList})`);
}
