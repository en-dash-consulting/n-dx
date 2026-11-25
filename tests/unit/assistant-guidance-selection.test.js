/**
 * Which guidance `ndx init` renders into CLAUDE.md and AGENTS.md.
 *
 * n-dx's own `project-guidance.md` describes the n-dx monorepo, so only an n-dx
 * checkout gets it, detected from its files. Every other project gets the
 * project-neutral `consumer-guidance.md`. No config key is read: a run cannot
 * write the tracked config, and the choice must not depend on one.
 *
 * @see packages/core/assistant-assets.js — `usesNdxGuidance`, `guidanceFor`
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  renderAgentsMd,
  renderClaudeMd,
  usesNdxGuidance,
} from "../../packages/core/assistant-assets.js";

const ROOT = join(import.meta.dirname, "../..");
const CONSUMER_HEADING = "# Working with n-dx in this repository";
const NDX_ONLY = ["Three packages that chain together", "Gateway modules", "four-tier", "tests/e2e/"];

let dir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ndx-guidance-select-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("guidance selection", () => {
  it("detects this repository as an n-dx checkout", () => {
    expect(usesNdxGuidance(ROOT)).toBe(true);
  });

  it("renders this repository's committed CLAUDE.md and AGENTS.md unchanged", () => {
    expect(renderClaudeMd(ROOT)).toBe(readFileSync(join(ROOT, "CLAUDE.md"), "utf-8"));
    expect(renderAgentsMd(ROOT)).toBe(readFileSync(join(ROOT, "AGENTS.md"), "utf-8"));
  });

  it("treats any other project as a consumer", () => {
    expect(usesNdxGuidance(dir)).toBe(false);
  });

  it("detects a checkout by its guidance source file", () => {
    const assets = join(dir, "packages", "core", "assistant-assets");
    mkdirSync(assets, { recursive: true });
    writeFileSync(join(assets, "project-guidance.md"), "# n-dx\n");
    expect(usesNdxGuidance(dir)).toBe(true);
  });

  it("reads no config key: a tracked opt-in does not select n-dx's guidance", () => {
    writeFileSync(join(dir, ".n-dx.json"), JSON.stringify({ assistant: { guidance: "n-dx" } }));
    expect(usesNdxGuidance(dir)).toBe(false);
    expect(renderClaudeMd(dir)).toContain(CONSUMER_HEADING);
  });

  for (const [name, render] of [["CLAUDE.md", renderClaudeMd], ["AGENTS.md", renderAgentsMd]]) {
    it(`renders a consumer ${name} with none of n-dx's own guidance`, () => {
      const text = render(dir);
      expect(text).toContain(CONSUMER_HEADING);
      expect(text).not.toMatch(/\{\{\w+\}\}/);
      for (const phrase of NDX_ONLY) expect(text, phrase).not.toContain(phrase);
    });
  }

  it("lands the Claude addendum in a consumer CLAUDE.md and leaves it out of AGENTS.md", () => {
    expect(renderClaudeMd(dir)).toContain("## Claude Code");
    expect(renderClaudeMd(dir)).not.toContain("<!-- ADDENDUM -->");
    expect(renderAgentsMd(dir)).not.toContain("## Claude Code");
  });

  it("filters the MCP Servers and Development Workflow guidance sections out of a consumer AGENTS.md", () => {
    const agents = renderAgentsMd(dir);
    // The consumer template's own versions, replaced by the manifest-derived ones.
    expect(agents).not.toContain("`.mcp.json` registers two stdio servers");
    expect(agents).not.toContain("Take a task with `get_next_task` and `claim_task`.");
    const claude = renderClaudeMd(dir);
    expect(claude).toContain("`.mcp.json` registers two stdio servers");
    expect(claude).toContain("Take a task with `get_next_task` and `claim_task`.");
  });
});
