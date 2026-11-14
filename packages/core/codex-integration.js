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

import { mkdirSync, writeFileSync, readFileSync, lstatSync, renameSync, unlinkSync } from "fs";
import { randomUUID } from "node:crypto";
import { join, resolve } from "path";
import {
  getSkillNames,
  getMcpServers,
  writeVendorSkills,
  renderCodexConfigToml,
  renderAgentsMd,
} from "./assistant-assets.js";
import { getCliName } from "./cli-identity.js";

// ── Config generation ──────────────────────────────────────────────────────────

/**
 * Locate ordinary TOML tables without reserializing operator text. This is a
 * deliberately conservative reader, not a general TOML parser: inline tables,
 * array tables, dotted assignments and multiline strings require manual merge.
 * Refuse those forms rather than guessing which bytes belong to our servers.
 * Strings and multiline arrays are consumed as values, never as table headers.
 */
function mergeCodexConfig(source, generated, file) {
  let i = 0;
  let table = [];
  const sections = [];
  const tables = new Set();
  const values = new Set();
  const owned = new Set(Object.keys(getMcpServers()));
  const fail = () => {
    throw new Error(`${file}: cannot safely merge TOML at line ${source.slice(0, i).split("\n").length}. Use ordinary [table] definitions and simple keys, strings, numbers, booleans or arrays; resolve duplicates and unsupported syntax, then re-run n-dx init. Existing config was not changed.`);
  };
  const inline = () => { while (/[ \t]/.test(source[i] ?? "\0")) i++; };
  const blank = () => {
    for (;;) {
      if (/\s/.test(source[i] ?? "\0")) i++;
      else if (source[i] === "#") { while (i < source.length && source[i] !== "\n") i++; }
      else break;
    }
  };
  const string = () => {
    const quote = source[i++];
    const start = i;
    if (source.slice(i, i + 2) === quote.repeat(2)) fail();
    while (i < source.length && source[i] !== quote) {
      if (source[i] === "\n" || source[i] === "\r" || source.charCodeAt(i) < 32 && source[i] !== "\t") fail();
      if (quote === '"' && source[i] === "\\") {
        i++;
        if (!'btnfr"\\u'.includes(source[i] ?? "\0")) fail();
      }
      i++;
    }
    if (source[i] !== quote) fail();
    const raw = source.slice(start, i++);
    if (quote === "'") return raw;
    try { return JSON.parse(`"${raw.replace(/\t/g, "\\t")}"`); }
    catch { fail(); }
  };
  const key = () => {
    inline();
    if (source[i] === '"' || source[i] === "'") return string();
    const match = /^[A-Za-z0-9_-]+/.exec(source.slice(i));
    if (!match) fail();
    i += match[0].length;
    return match[0];
  };
  const end = () => {
    inline();
    if (source[i] === "#") while (i < source.length && source[i] !== "\n") i++;
    if (source[i] === "\r") i++;
    if (i < source.length && source[i] !== "\n") fail();
    if (source[i] === "\n") i++;
  };
  const value = () => {
    inline();
    if (source[i] === '"' || source[i] === "'") { string(); return; }
    if (source[i] === "[") {
      i++;
      blank();
      while (source[i] !== "]") {
        value();
        blank();
        if (source[i] === "]") break;
        if (source[i++] !== ",") fail();
        blank();
      }
      i++;
      return;
    }
    const match = /^(?:true|false|[+-]?(?:inf|nan)|[+-]?(?:0|[1-9](?:_?\d)*)(?:\.\d(?:_?\d)*)?(?:[eE][+-]?\d(?:_?\d)*)?)(?=[\s,\]#]|$)/.exec(source.slice(i));
    if (!match) fail();
    i += match[0].length;
  };
  const pathKey = (path) => JSON.stringify(path);
  const hasValueParent = (path) => path.some((_, n) => values.has(pathKey(path.slice(0, n + 1))));
  while (i < source.length) {
    blank();
    if (i === source.length) break;
    if (source[i] === "[") {
      const start = i++;
      table = [key()];
      inline();
      while (source[i] === ".") { i++; table.push(key()); inline(); }
      if (source[i++] !== "]") fail();
      end();
      if (tables.has(pathKey(table)) || hasValueParent(table)) fail();
      tables.add(pathKey(table));
      sections.push({ start, owned: table[0] === "mcp_servers" && owned.has(table[1]) });
    } else {
      const path = [...table, key()];
      inline();
      if (source[i++] !== "=" || path[0] === "mcp_servers" && path.length < 3) fail();
      if (hasValueParent(path) || tables.has(pathKey(path))) fail();
      // A prior child table also prevents assigning a scalar to its parent.
      if ([...tables].some((t) => {
        const child = JSON.parse(t);
        return child.length > path.length && path.every((p, n) => child[n] === p);
      })) fail();
      value();
      end();
      values.add(pathKey(path));
    }
  }
  let kept = "";
  let cursor = 0;
  for (let n = 0; n < sections.length; n++) {
    if (!sections[n].owned) continue;
    kept += source.slice(cursor, sections[n].start);
    cursor = sections[n + 1]?.start ?? source.length;
  }
  kept += source.slice(cursor);
  const definitions = generated.slice(generated.indexOf("[mcp_servers."));
  return kept + (kept && !kept.endsWith("\n") ? "\n" : "") + definitions;
}

/**
 * Merge n-dx-owned stdio MCP tables into `.codex/config.toml`.
 *
 * A fresh file contains only MCP server definitions (no sandbox,
 * approval, or model configuration).  This matches the locked decision
 * in docs/process/codex-transport-artifact-decisions.md §5.
 *
 * Commands are cwd-relative (`<cliName> <cliCommand> mcp .`) rather than
 * absolute paths — see the dated update in
 * docs/archive/codex-transport-artifact-decisions.md.
 *
 * @param {string} dir  Absolute project root directory
 * @returns {{ written: boolean, path: string, serverCount: number }}
 */
function writeCodexConfig(dir) {
  const codexDir = join(dir, ".codex");
  mkdirSync(codexDir, { recursive: true });

  const configPath = join(codexDir, "config.toml");
  if (!lstatSync(codexDir).isDirectory()) {
    throw new Error(`${configPath}: .codex must be a regular directory; existing config was not changed.`);
  }
  const cliName = getCliName(dir);
  let stat;
  try { stat = lstatSync(configPath); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  if (stat && (!stat.isFile() || stat.nlink !== 1)) {
    throw new Error(`${configPath}: expected a regular config file without links; existing config was not changed.`);
  }
  const generated = renderCodexConfigToml(cliName);
  // Fatal decoding refuses damaged UTF-8 instead of replacing operator bytes.
  let source = null;
  if (stat) {
    try { source = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(readFileSync(configPath)); }
    catch (error) { throw new Error(`${configPath}: cannot read UTF-8 config; existing config was not changed.`, { cause: error }); }
  }
  const content = source === null ? generated : mergeCodexConfig(source, generated, configPath);
  if (source !== content) {
    const temporary = join(codexDir, `.config-${randomUUID()}.tmp`);
    try {
      writeFileSync(temporary, content, { flag: "wx", mode: stat ? stat.mode & 0o777 : 0o600 });
      renameSync(temporary, configPath);
    } finally {
      try { unlinkSync(temporary); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
    }
  }

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
  const content = renderAgentsMd(dir);
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
