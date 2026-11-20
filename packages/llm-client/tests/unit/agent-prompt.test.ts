import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  AGENT_PROMPT_MAX_BYTES,
  agentPromptSection,
  formatAgentPromptSection,
  readAgentPrompt,
  resolveAgentPromptPath,
  writeAgentPrompt,
} from "../../src/agent-prompt.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ndx-agent-prompt-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function useNdxLayout(): string {
  mkdirSync(join(root, ".ndx"), { recursive: true });
  return join(root, ".ndx", "agent-prompt.md");
}

describe("resolveAgentPromptPath", () => {
  it("defaults to .ndx/agent-prompt.md on the .ndx/ layout", () => {
    useNdxLayout();
    const location = resolveAgentPromptPath(root);
    expect(location).toEqual({
      path: join(root, ".ndx", "agent-prompt.md"),
      relativePath: ".ndx/agent-prompt.md",
      configured: false,
      error: null,
    });
  });

  it("defaults to .n-dx-agent-prompt.md on the legacy layout", () => {
    expect(resolveAgentPromptPath(root).relativePath).toBe(".n-dx-agent-prompt.md");
  });

  it("honours agent.promptFile, the local overlay winning", () => {
    writeFileSync(join(root, ".n-dx.json"), JSON.stringify({ agent: { promptFile: "docs/shared.md" } }));
    expect(resolveAgentPromptPath(root)).toMatchObject({ relativePath: "docs/shared.md", configured: true, error: null });

    writeFileSync(join(root, ".n-dx.local.json"), JSON.stringify({ agent: { promptFile: "mine.md" } }));
    expect(resolveAgentPromptPath(root).relativePath).toBe("mine.md");
  });

  it("refuses a configured path outside the project and falls back to the default", () => {
    for (const escape of ["../outside.md", join(tmpdir(), "elsewhere.md")]) {
      writeFileSync(join(root, ".n-dx.json"), JSON.stringify({ agent: { promptFile: escape } }));
      const location = resolveAgentPromptPath(root);
      expect(location.relativePath).toBe(".n-dx-agent-prompt.md");
      expect(location.configured).toBe(false);
      expect(location.error).toContain("outside the project");
    }
  });

  it("refuses a non-string agent.promptFile", () => {
    writeFileSync(join(root, ".n-dx.json"), JSON.stringify({ agent: { promptFile: 42 } }));
    expect(resolveAgentPromptPath(root).error).toContain("must be a path string");
  });
});

describe("readAgentPrompt", () => {
  it("reports an absent file as empty, with no warnings", () => {
    const prompt = readAgentPrompt(root);
    expect(prompt).toMatchObject({ exists: false, content: "", bytes: 0, truncated: false, warnings: [] });
    expect(agentPromptSection(root)).toEqual({ text: "", warnings: [] });
  });

  it("treats a whitespace-only file as no section", () => {
    writeFileSync(useNdxLayout(), "  \n\n\t\n");
    const prompt = readAgentPrompt(root);
    expect(prompt.exists).toBe(true);
    expect(agentPromptSection(root).text).toBe("");
  });

  it("formats a heading naming the file, then the trimmed text", () => {
    writeFileSync(useNdxLayout(), "\nPrefer small commits.\n");
    const { text, warnings } = agentPromptSection(root);
    expect(warnings).toEqual([]);
    expect(text.startsWith("## Project instructions from .ndx/agent-prompt.md\n")).toBe(true);
    expect(text.endsWith("\n\nPrefer small commits.")).toBe(true);
  });

  it("truncates past the cap on a character boundary and warns", () => {
    // A 3-byte character straddling the cap must not be split into U+FFFD.
    const body = "a".repeat(AGENT_PROMPT_MAX_BYTES - 1) + "€" + "tail";
    writeFileSync(useNdxLayout(), body);
    const prompt = readAgentPrompt(root);
    expect(prompt.truncated).toBe(true);
    expect(prompt.bytes).toBe(Buffer.byteLength(body));
    expect(Buffer.byteLength(prompt.content)).toBeLessThanOrEqual(AGENT_PROMPT_MAX_BYTES);
    expect(prompt.content).toBe("a".repeat(AGENT_PROMPT_MAX_BYTES - 1));
    expect(prompt.content).not.toContain("�");
    expect(prompt.warnings).toEqual([expect.stringContaining("only the first 32 KB")]);
  });

  it("does not truncate a file of exactly the cap", () => {
    writeFileSync(useNdxLayout(), "b".repeat(AGENT_PROMPT_MAX_BYTES));
    const prompt = readAgentPrompt(root);
    expect(prompt.truncated).toBe(false);
    expect(prompt.warnings).toEqual([]);
  });

  it("ignores a default file that is a symlink out of the project", () => {
    const outside = mkdtempSync(join(tmpdir(), "ndx-agent-prompt-outside-"));
    try {
      writeFileSync(join(outside, "secret.md"), "secret");
      try {
        symlinkSync(join(outside, "secret.md"), useNdxLayout());
      } catch {
        return; // symlinks need privileges on some Windows hosts
      }
      const prompt = readAgentPrompt(root);
      expect(prompt.content).toBe("");
      expect(prompt.warnings).toEqual([expect.stringContaining("outside the project")]);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe("formatAgentPromptSection", () => {
  it("is empty for empty content", () => {
    expect(formatAgentPromptSection({ content: "", relativePath: "x.md" })).toBe("");
  });
});

describe("writeAgentPrompt", () => {
  it("creates the file and its directory", () => {
    writeFileSync(join(root, ".n-dx.json"), JSON.stringify({ agent: { promptFile: "docs/agents/prompt.md" } }));
    const written = writeAgentPrompt(root, "Hello");
    expect(readFileSync(join(root, "docs", "agents", "prompt.md"), "utf-8")).toBe("Hello");
    expect(written).toMatchObject({ exists: true, content: "Hello", bytes: 5 });
  });

  it("does not create a file for empty content", () => {
    writeAgentPrompt(root, "");
    expect(existsSync(join(root, ".n-dx-agent-prompt.md"))).toBe(false);
  });

  it("refuses content over the cap and a location outside the project", () => {
    expect(() => writeAgentPrompt(root, "x".repeat(AGENT_PROMPT_MAX_BYTES + 1))).toThrow(/limit is 32 KB/);
    writeFileSync(join(root, ".n-dx.json"), JSON.stringify({ agent: { promptFile: "../escape.md" } }));
    expect(() => writeAgentPrompt(root, "x")).toThrow(/outside the project/);
  });
});
