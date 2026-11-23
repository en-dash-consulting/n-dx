/**
 * The project's agent prompt file: operator-written instructions appended to
 * the system prompt of every n-dx agent process.
 *
 * ## Where it lives
 *
 * The layout resolver names the default — `.ndx/agent-prompt.md`, or
 * `.n-dx-agent-prompt.md` on the legacy layout — so `ndx migrate-layout` moves
 * it with everything else. `agent.promptFile` in the project config (or its
 * machine-local overlay, which wins) points somewhere else, relative to the
 * project root.
 *
 * ## Why the path must stay inside the project
 *
 * The project config is usually tracked, so a clone can name the file. A path
 * that escaped the checkout — `../../.ssh/id_rsa`, an absolute path, a symlink
 * out — would send a file from the operator's machine to a model, and the
 * dashboard's editor would write there. Such a path is refused: the reader
 * falls back to the default and reports why, and a writer refuses outright.
 *
 * ## Absent and empty mean "no change"
 *
 * A project with no file, or with only whitespace in it, gets exactly the
 * system prompt it had before this file existed. {@link agentPromptSection}
 * returns an empty string and callers append nothing.
 *
 * ## The cap
 *
 * {@link AGENT_PROMPT_MAX_BYTES} bounds what reaches a model: every agent turn
 * pays for the text, and a pasted log should not silently cost a run its
 * budget. A longer file is truncated on a character boundary and the reader
 * says so in `warnings`.
 *
 * @module agent-prompt
 */

import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

import { relativeToRoot, resolveLayout } from "./layout.js";

/** Most bytes of the file that reach a model. */
export const AGENT_PROMPT_MAX_BYTES = 32 * 1024;

/** The project config key that overrides the file's location. */
export const AGENT_PROMPT_CONFIG_KEY = "agent.promptFile";

/** Where the agent prompt file is, and how that was decided. */
export interface AgentPromptLocation {
  /** Absolute path. */
  path: string;
  /** Path relative to the project root, forward slashes. */
  relativePath: string;
  /** True when `agent.promptFile` named it; false for the layout default. */
  configured: boolean;
  /**
   * Why a configured path was not used (outside the project, not a string),
   * else null. The location is then the default.
   */
  error: string | null;
}

/** The file as read, after the cap. */
export interface AgentPrompt extends AgentPromptLocation {
  exists: boolean;
  /** The file's text, truncated to {@link AGENT_PROMPT_MAX_BYTES}. Empty when absent. */
  content: string;
  /** The file's full size in bytes. */
  bytes: number;
  /** Whether `content` is shorter than the file. */
  truncated: boolean;
  /** Problems worth telling the operator: a refused path, truncation, an unreadable file. */
  warnings: string[];
}

/** What a caller appends to a system prompt, and what to tell the operator. */
export interface AgentPromptSection {
  /** The delimited section, or "" when there is nothing to add. */
  text: string;
  warnings: string[];
}

/** Whether `child` is `root` or inside it. */
function isInside(root: string, child: string): boolean {
  const rel = relative(root, child);
  if (rel === "") return true;
  return !isAbsolute(rel) && rel !== ".." && !rel.startsWith(".." + sep);
}

/** More links than any real layout chains; past it, the path is treated as escaping. */
const MAX_LINK_HOPS = 40;

/**
 * Where a write to `path` would land, as far as the disk can say: `path`
 * resolved through symlinks when it exists, else its nearest existing
 * ancestor so resolved. A symlink that exists but resolves to nothing (a
 * dangling link) is followed to its target, which a write would create, and
 * that target is checked in turn — never the link's own parent, which would
 * pass a link pointing out of the project. Throws on a link loop.
 */
function realExisting(path: string, hops = 0): string {
  if (hops > MAX_LINK_HOPS) throw new Error(`Too many symbolic links resolving ${path}`);
  let current = path;
  for (;;) {
    try {
      return realpathSync(current);
    } catch {
      let link: string | null = null;
      try {
        if (lstatSync(current).isSymbolicLink()) link = readlinkSync(current);
      } catch {
        // Not there at all: its parent decides.
      }
      if (link !== null) return realExisting(resolve(dirname(current), link), hops + 1);
      const parent = dirname(current);
      if (parent === current) return current;
      current = parent;
    }
  }
}

/**
 * Whether `path` stays inside `root` once symlinks are followed. The nearest
 * existing ancestor is checked when the file does not exist yet, so a
 * symlinked directory cannot carry a write outside the project either, and a
 * dangling link is judged by where it points. A path that cannot be resolved
 * (a link loop) does not stay inside.
 */
function staysInside(root: string, path: string): boolean {
  if (!isInside(root, path)) return false;
  try {
    const realRoot = realExisting(root);
    return isInside(realRoot, realExisting(path));
  } catch {
    return false;
  }
}

/** `agent.promptFile` from the project config and its local overlay (local wins); undefined when unset. */
function configuredPromptFile(projectDir: string): unknown {
  const layout = resolveLayout(projectDir);
  let value: unknown;
  for (const file of [layout.configFile, layout.localConfigFile]) {
    try {
      const data = JSON.parse(readFileSync(file, "utf-8")) as unknown;
      const agent = data && typeof data === "object" ? (data as Record<string, unknown>).agent : undefined;
      if (agent && typeof agent === "object" && "promptFile" in agent) {
        value = (agent as Record<string, unknown>).promptFile;
      }
    } catch {
      // Absent or unparseable: the other file, or the default, decides.
    }
  }
  return value;
}

/** Resolve where the project's agent prompt file is. Never throws. */
export function resolveAgentPromptPath(projectDir: string): AgentPromptLocation {
  const root = resolve(projectDir);
  const layout = resolveLayout(root);
  const fallback = (error: string | null): AgentPromptLocation => ({
    path: layout.agentPromptFile,
    relativePath: relativeToRoot(layout, layout.agentPromptFile),
    configured: false,
    error,
  });

  const configured = configuredPromptFile(root);
  if (configured === undefined || configured === null || configured === "") return fallback(null);
  if (typeof configured !== "string") {
    return fallback(`${AGENT_PROMPT_CONFIG_KEY} must be a path string; using the default.`);
  }
  const path = resolve(root, configured);
  if (!staysInside(root, path)) {
    return fallback(`${AGENT_PROMPT_CONFIG_KEY} "${configured}" is outside the project; using the default.`);
  }
  return { path, relativePath: relativeToRoot(layout, path), configured: true, error: null };
}

/** Cut `text` to at most `maxBytes` UTF-8 bytes without splitting a character. */
function truncateUtf8(text: string, maxBytes: number): string {
  const buf = Buffer.from(text, "utf-8");
  if (buf.length <= maxBytes) return text;
  let end = maxBytes;
  // Step back over continuation bytes (10xxxxxx) to the start of a character.
  while (end > 0 && (buf[end]! & 0xc0) === 0x80) end--;
  return buf.subarray(0, end).toString("utf-8");
}

/** Read the project's agent prompt file. Never throws: problems land in `warnings`. */
export function readAgentPrompt(projectDir: string): AgentPrompt {
  const location = resolveAgentPromptPath(projectDir);
  const warnings: string[] = location.error ? [location.error] : [];
  const empty: AgentPrompt = { ...location, exists: false, content: "", bytes: 0, truncated: false, warnings };

  if (!existsSync(location.path)) return empty;
  // The default path can be a symlink out of the project even when no config names it.
  if (!staysInside(resolve(projectDir), location.path)) {
    warnings.push(`${location.relativePath} resolves outside the project; ignored.`);
    return empty;
  }
  let raw: string;
  try {
    if (!statSync(location.path).isFile()) {
      warnings.push(`${location.relativePath} is not a file; ignored.`);
      return empty;
    }
    raw = readFileSync(location.path, "utf-8");
  } catch (err) {
    warnings.push(`${location.relativePath} could not be read: ${err instanceof Error ? err.message : String(err)}`);
    return empty;
  }

  const bytes = Buffer.byteLength(raw, "utf-8");
  const truncated = bytes > AGENT_PROMPT_MAX_BYTES;
  if (truncated) {
    warnings.push(
      `${location.relativePath} is ${formatKb(bytes)}; only the first ${formatKb(AGENT_PROMPT_MAX_BYTES)} is sent to agents.`,
    );
  }
  return {
    ...location,
    exists: true,
    content: truncated ? truncateUtf8(raw, AGENT_PROMPT_MAX_BYTES) : raw,
    bytes,
    truncated,
    warnings,
  };
}

function formatKb(bytes: number): string {
  return `${(bytes / 1024).toFixed(bytes % 1024 === 0 ? 0 : 1)} KB`;
}

/**
 * The system-prompt section for a read prompt: a heading naming the file, then
 * its text. Empty when the file is absent or holds only whitespace.
 */
export function formatAgentPromptSection(prompt: Pick<AgentPrompt, "content" | "relativePath">): string {
  const body = prompt.content.trim();
  if (!body) return "";
  return [
    `## Project instructions from ${prompt.relativePath}`,
    "The project's operator wrote these for every n-dx agent working in this repository.",
    "",
    body,
  ].join("\n");
}

/** Read the file and format it: what a caller appends to its system prompt. */
export function agentPromptSection(projectDir: string): AgentPromptSection {
  const prompt = readAgentPrompt(projectDir);
  return { text: formatAgentPromptSection(prompt), warnings: prompt.warnings };
}

/**
 * Write the project's agent prompt file, creating its directory. Refuses a
 * location outside the project and content over the cap, by throwing.
 *
 * Writing an empty string to an absent file is a no-op: there is nothing to
 * clear, and an empty file would change nothing.
 */
export function writeAgentPrompt(projectDir: string, content: string): AgentPrompt {
  const root = resolve(projectDir);
  const location = resolveAgentPromptPath(root);
  if (location.error) throw new Error(location.error);
  if (!staysInside(root, location.path)) {
    throw new Error(`${location.relativePath} resolves outside the project.`);
  }
  const bytes = Buffer.byteLength(content, "utf-8");
  if (bytes > AGENT_PROMPT_MAX_BYTES) {
    throw new Error(`The agent prompt is ${formatKb(bytes)}; the limit is ${formatKb(AGENT_PROMPT_MAX_BYTES)}.`);
  }
  if (content === "" && !existsSync(location.path)) return readAgentPrompt(root);
  mkdirSync(dirname(location.path), { recursive: true });
  writeFileSync(location.path, content, "utf-8");
  return readAgentPrompt(root);
}
