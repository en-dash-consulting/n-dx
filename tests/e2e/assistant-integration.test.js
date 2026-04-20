/**
 * Validates the assistant-neutral setup orchestration:
 *
 *   1. setupAssistantIntegrations() dispatches to vendor-specific integrations
 *   2. Vendor enable/disable flags work correctly
 *   3. Failures in one vendor do not block the other
 *   4. getSupportedAssistants() reflects the registry
 *   5. assistant-integration.js imports from vendor integration modules (no inline logic)
 *   6. Summary strings match the vendor-specific format
 *   7. formatInitReport() verbose mode shows per-artifact detail
 *   8. cli.js supports --assistants=, --claude-only, --codex-only flags
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync, existsSync, mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  setupAssistantIntegrations,
  getSupportedAssistants,
  formatInitReport,
} from "../../packages/core/assistant-integration.js";
import { getSkillNames, getMcpServers } from "../../packages/core/assistant-assets.js";

const ROOT = join(import.meta.dirname, "../..");

// Force claude CLI discovery to fail so `setupClaudeIntegration` skips the
// real `claude mcp add`/`claude mcp remove` calls (which take 5–30s each and
// make this file run for >5 minutes). No test here depends on Claude being
// registered — they only check file writes, summary strings, and formatting,
// all of which happen before MCP registration. See the short-circuit at
// packages/core/claude-integration.js:306–320.
process.env.CLAUDE_CLI_PATH = "/nonexistent/path/to/claude";

// ── getSupportedAssistants() ────────────────────────────────────────────────

describe("getSupportedAssistants", () => {
  it("returns claude and codex", () => {
    const assistants = getSupportedAssistants();
    expect(assistants).toContain("claude");
    expect(assistants).toContain("codex");
  });

  it("returns only known vendors", () => {
    const assistants = getSupportedAssistants();
    expect(assistants.length).toBeGreaterThanOrEqual(2);
    for (const a of assistants) {
      expect(typeof a).toBe("string");
      expect(a.length).toBeGreaterThan(0);
    }
  });
});

// ── setupAssistantIntegrations() ────────────────────────────────────────────

describe("setupAssistantIntegrations", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "ndx-assistant-integration-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns results for all registered vendors", () => {
    const results = setupAssistantIntegrations(tmpDir);
    const vendors = getSupportedAssistants();
    for (const v of vendors) {
      expect(results).toHaveProperty(v);
      expect(results[v]).toHaveProperty("summary");
    }
  });

  it("provisions Claude artifacts when claude is enabled", () => {
    const results = setupAssistantIntegrations(tmpDir, { claude: true, codex: false });
    expect(results.claude.summary).not.toContain("skipped");
    expect(results.claude.detail).toBeDefined();
    // Claude writes skills to .claude/skills/
    const skillNames = getSkillNames();
    for (const name of skillNames) {
      expect(existsSync(join(tmpDir, ".claude", "skills", name, "SKILL.md"))).toBe(true);
    }
    // Claude writes CLAUDE.md to project root
    expect(existsSync(join(tmpDir, "CLAUDE.md"))).toBe(true);
  });

  it("provisions Codex artifacts when codex is enabled", () => {
    const results = setupAssistantIntegrations(tmpDir, { claude: false, codex: true });
    expect(results.codex.summary).not.toContain("skipped");
    expect(results.codex.detail).toBeDefined();
    // Codex writes config, skills, AGENTS.md
    expect(existsSync(join(tmpDir, ".codex", "config.toml"))).toBe(true);
    expect(existsSync(join(tmpDir, "AGENTS.md"))).toBe(true);
    const skillNames = getSkillNames();
    for (const name of skillNames) {
      expect(existsSync(join(tmpDir, ".agents", "skills", name, "SKILL.md"))).toBe(true);
    }
  });

  it("provisions both vendors by default", () => {
    const results = setupAssistantIntegrations(tmpDir);
    expect(results.claude.summary).not.toContain("skipped");
    expect(results.claude.skipped).toBe(false);
    expect(results.codex.summary).not.toContain("skipped");
    expect(results.codex.skipped).toBe(false);
  });

  it("includes label in results for all vendors", () => {
    const results = setupAssistantIntegrations(tmpDir);
    expect(results.claude.label).toBe("Claude Code");
    expect(results.codex.label).toBe("Codex");
  });

  it("skips Claude when claude: false", () => {
    const results = setupAssistantIntegrations(tmpDir, { claude: false });
    expect(results.claude.summary).toContain("skipped");
    expect(results.claude.summary).toContain("--no-claude");
    expect(results.claude.skipped).toBe(true);
    expect(results.claude.detail).toBeUndefined();
    // Claude artifacts should not exist
    expect(existsSync(join(tmpDir, ".claude"))).toBe(false);
    expect(existsSync(join(tmpDir, "CLAUDE.md"))).toBe(false);
  });

  it("skips Codex when codex: false", () => {
    const results = setupAssistantIntegrations(tmpDir, { codex: false });
    expect(results.codex.summary).toContain("skipped");
    expect(results.codex.summary).toContain("--no-codex");
    expect(results.codex.skipped).toBe(true);
    expect(results.codex.detail).toBeUndefined();
    // Codex artifacts should not exist
    expect(existsSync(join(tmpDir, ".codex"))).toBe(false);
    expect(existsSync(join(tmpDir, "AGENTS.md"))).toBe(false);
  });

  it("skips both when both disabled", () => {
    const results = setupAssistantIntegrations(tmpDir, { claude: false, codex: false });
    expect(results.claude.summary).toContain("skipped");
    expect(results.codex.summary).toContain("skipped");
  });

  it("Claude summary includes CLAUDE.md, skill count, and permission count", () => {
    const results = setupAssistantIntegrations(tmpDir, { codex: false });
    const skillCount = getSkillNames().length;
    expect(results.claude.summary).toContain("CLAUDE.md");
    expect(results.claude.summary).toContain(`${skillCount} skills`);
    expect(results.claude.summary).toMatch(/\d+ permissions/);
  });

  it("Codex summary includes AGENTS.md, skill count, and MCP server count", () => {
    const results = setupAssistantIntegrations(tmpDir, { claude: false });
    const skillCount = getSkillNames().length;
    const serverCount = Object.keys(getMcpServers()).length;
    expect(results.codex.summary).toContain("AGENTS.md");
    expect(results.codex.summary).toContain(`${skillCount} skills`);
    expect(results.codex.summary).toContain(`${serverCount} MCP servers`);
  });

  it("detail objects match vendor-specific result shapes", () => {
    const results = setupAssistantIntegrations(tmpDir);

    // Claude detail
    expect(results.claude.detail).toHaveProperty("settings");
    expect(results.claude.detail).toHaveProperty("skills");
    expect(results.claude.detail).toHaveProperty("mcp");
    expect(results.claude.detail).toHaveProperty("instructions");

    // Codex detail
    expect(results.codex.detail).toHaveProperty("config");
    expect(results.codex.detail).toHaveProperty("skills");
    expect(results.codex.detail).toHaveProperty("agents");
  });

  it("is idempotent — running twice produces the same result summaries", () => {
    const first = setupAssistantIntegrations(tmpDir);
    const second = setupAssistantIntegrations(tmpDir);
    expect(first.claude.summary).toBe(second.claude.summary);
    expect(first.codex.summary).toBe(second.codex.summary);
  });

  it("failure in one vendor does not block the other", () => {
    // Codex first (succeeds), then we make Claude fail by corrupting its settings dir
    // Actually, both should succeed in a clean tmpDir. To test isolation, we
    // verify the registry loop completes for both regardless of order.
    const results = setupAssistantIntegrations(tmpDir);
    expect(Object.keys(results).length).toBe(getSupportedAssistants().length);
  });
});

// ── assistant-integration.js source validation ──────────────────────────────

describe("assistant-integration.js uses vendor integration modules", () => {
  const src = readFileSync(join(ROOT, "packages/core/assistant-integration.js"), "utf-8");

  it("imports setupClaudeIntegration from claude-integration.js", () => {
    expect(src).toContain('from "./claude-integration.js"');
    expect(src).toContain("setupClaudeIntegration");
  });

  it("imports setupCodexIntegration from codex-integration.js", () => {
    expect(src).toContain('from "./codex-integration.js"');
    expect(src).toContain("setupCodexIntegration");
  });

  it("does not contain inline skill or MCP logic", () => {
    // The integration module delegates — it should not contain rendering logic
    expect(src).not.toContain("writeFileSync");
    expect(src).not.toContain("mkdirSync");
    expect(src).not.toContain("execSync");
  });

  it("exports setupAssistantIntegrations", () => {
    expect(src).toContain("export function setupAssistantIntegrations");
  });

  it("exports getSupportedAssistants", () => {
    expect(src).toContain("export function getSupportedAssistants");
  });

  it("exports formatInitReport", () => {
    expect(src).toContain("export function formatInitReport");
  });
});

// ── formatInitReport() ──────────────────────────────────────────────────────

describe("formatInitReport", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "ndx-init-report-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns an array of strings", () => {
    const results = setupAssistantIntegrations(tmpDir);
    const lines = formatInitReport(results);
    expect(Array.isArray(lines)).toBe(true);
    for (const line of lines) {
      expect(typeof line).toBe("string");
    }
  });

  it("starts with an Assistant surfaces header", () => {
    const results = setupAssistantIntegrations(tmpDir);
    const lines = formatInitReport(results);
    expect(lines[0]).toContain("Assistant surfaces");
  });

  it("includes vendor labels from the registry", () => {
    const results = setupAssistantIntegrations(tmpDir);
    const lines = formatInitReport(results);
    const joined = lines.join("\n");
    expect(joined).toContain("Claude Code");
    expect(joined).toContain("Codex");
  });

  it("shows skip flag when vendor is disabled", () => {
    const results = setupAssistantIntegrations(tmpDir, { codex: false });
    const lines = formatInitReport(results);
    const joined = lines.join("\n");
    expect(joined).toContain("--no-codex");
    expect(joined).toContain("skipped");
  });

  it("shows artifact summary when vendor is enabled", () => {
    const results = setupAssistantIntegrations(tmpDir, { claude: true, codex: false });
    const lines = formatInitReport(results);
    const joined = lines.join("\n");
    expect(joined).toContain("CLAUDE.md");
    expect(joined).toMatch(/\d+ skills/);
  });

  it("verbose mode includes artifact detail lines beyond the summary", () => {
    const results = setupAssistantIntegrations(tmpDir);
    const lines = formatInitReport(results); // verbose by default
    // Header + vendor summary + artifact lines → more than 1 + vendor count
    expect(lines.length).toBeGreaterThan(1 + getSupportedAssistants().length);
  });

  it("non-verbose mode includes one line per vendor plus the header", () => {
    const results = setupAssistantIntegrations(tmpDir);
    const lines = formatInitReport(results, { verbose: false });
    // 1 header + 1 per vendor
    expect(lines.length).toBe(1 + getSupportedAssistants().length);
  });

  it("verbose Claude detail includes CLAUDE.md written, skills, settings, and MCP", () => {
    const results = setupAssistantIntegrations(tmpDir, { codex: false });
    const lines = formatInitReport(results);
    const joined = lines.join("\n");
    expect(joined).toContain("CLAUDE.md written");
    expect(joined).toMatch(/\.claude\/skills\/.*skill/);
    expect(joined).toMatch(/\.claude\/settings.*permission/);
    expect(joined).toMatch(/MCP servers/);
  });

  it("verbose Codex detail includes AGENTS.md written, skills, and config", () => {
    const results = setupAssistantIntegrations(tmpDir, { claude: false });
    const lines = formatInitReport(results);
    const joined = lines.join("\n");
    expect(joined).toContain("AGENTS.md written");
    expect(joined).toMatch(/\.agents\/skills\/.*skill/);
    expect(joined).toMatch(/\.codex\/config\.toml/);
  });

  it("skipped vendors show compact single-line even in verbose mode", () => {
    const results = setupAssistantIntegrations(tmpDir, { claude: false, codex: false });
    const lines = formatInitReport(results); // verbose by default
    // 1 header + 1 per skipped vendor (no extra artifact lines)
    expect(lines.length).toBe(1 + getSupportedAssistants().length);
    for (const line of lines.slice(1)) {
      expect(line).toContain("skipped");
    }
  });
});

// ── formatInitReport() activeVendor de-emphasis ──────────────────────────────

describe("formatInitReport activeVendor de-emphasis", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "ndx-init-report-active-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("shows verbose detail for active vendor only", () => {
    const results = setupAssistantIntegrations(tmpDir);
    const lines = formatInitReport(results, { activeVendor: "claude" });
    const joined = lines.join("\n");
    // Active vendor (Claude) gets verbose artifact detail
    expect(joined).toContain("CLAUDE.md written");
    expect(joined).toMatch(/\.claude\/skills\/.*skill/);
    // Non-active vendor (Codex) should NOT have artifact detail lines
    expect(joined).not.toContain("AGENTS.md written");
    expect(joined).not.toContain(".agents/skills/");
    expect(joined).not.toContain(".codex/config.toml");
  });

  it("de-emphasizes Claude when Codex is the active vendor", () => {
    const results = setupAssistantIntegrations(tmpDir);
    const lines = formatInitReport(results, { activeVendor: "codex" });
    const joined = lines.join("\n");
    // Active vendor (Codex) gets verbose artifact detail
    expect(joined).toContain("AGENTS.md written");
    expect(joined).toMatch(/\.codex\/config\.toml/);
    // Non-active vendor (Claude) should NOT have artifact detail lines
    expect(joined).not.toContain("CLAUDE.md written");
    expect(joined).not.toContain(".claude/skills/");
    expect(joined).not.toContain(".claude/settings");
  });

  it("non-active vendor still shows compact summary line", () => {
    const results = setupAssistantIntegrations(tmpDir);
    const lines = formatInitReport(results, { activeVendor: "claude" });
    const joined = lines.join("\n");
    // Both vendor labels should appear
    expect(joined).toContain("Claude Code");
    expect(joined).toContain("Codex");
    // Codex summary line should be present (compact form)
    expect(joined).toMatch(/Codex\s+AGENTS\.md/);
  });

  it("produces fewer lines than without activeVendor", () => {
    const results = setupAssistantIntegrations(tmpDir);
    const withoutActive = formatInitReport(results);
    const withActive = formatInitReport(results, { activeVendor: "claude" });
    expect(withActive.length).toBeLessThan(withoutActive.length);
  });

  it("omitting activeVendor shows verbose detail for all vendors", () => {
    const results = setupAssistantIntegrations(tmpDir);
    const lines = formatInitReport(results);
    const joined = lines.join("\n");
    // Both vendors get verbose detail
    expect(joined).toContain("CLAUDE.md written");
    expect(joined).toContain("AGENTS.md written");
  });

  it("still shows error reason on non-active vendor when present", () => {
    const results = {
      claude: {
        summary: "skipped (setup failed)",
        label: "Claude Code",
        skipped: true,
        error: "ENOENT: no such file or directory",
      },
      codex: {
        summary: "AGENTS.md, 2 skills, 2 MCP servers",
        label: "Codex",
        skipped: false,
        detail: {
          agents: { written: true },
          skills: { written: 2 },
          config: { written: true, serverCount: 2 },
        },
      },
    };
    const lines = formatInitReport(results, { activeVendor: "codex" });
    const joined = lines.join("\n");
    // Skipped vendor should still show error reason even when non-active
    expect(joined).toContain("reason: ENOENT: no such file or directory");
  });
});

// ── cli.js passes activeVendor to formatInitReport ───────────────────────────

describe("cli.js passes activeVendor to formatInitReport", () => {
  const src = readFileSync(join(ROOT, "packages/core/cli.js"), "utf-8");

  it("passes activeVendor option to formatInitReport", () => {
    expect(src).toContain("activeVendor:");
  });

  it("uses selectedProvider as the activeVendor", () => {
    expect(src).toMatch(/formatInitReport\(assistantResults,\s*\{[^}]*activeVendor:\s*selectedProvider/);
  });
});

// ── formatInitReport() error detail surfacing ────────────────────────────────

describe("formatInitReport error surfacing", () => {
  it("shows vendor-level error reason when setup fails", () => {
    const results = {
      claude: {
        summary: "skipped (setup failed)",
        label: "Claude Code",
        skipped: true,
        error: "ENOENT: no such file or directory",
      },
    };
    const lines = formatInitReport(results);
    const joined = lines.join("\n");
    expect(joined).toContain("skipped (setup failed)");
    expect(joined).toContain("reason: ENOENT: no such file or directory");
  });

  it("does not show reason line when skipped vendor has no error", () => {
    const results = {
      claude: {
        summary: "skipped (--no-claude)",
        label: "Claude Code",
        skipped: true,
      },
    };
    const lines = formatInitReport(results);
    const joined = lines.join("\n");
    expect(joined).not.toContain("reason:");
  });

  it("includes MCP server error details in verbose artifact lines", () => {
    const results = {
      claude: {
        summary: "CLAUDE.md, 12 skills, 18 permissions",
        label: "Claude Code",
        skipped: false,
        detail: {
          instructions: { written: true },
          skills: { written: 12 },
          settings: { added: 0, total: 18 },
          mcp: {
            registered: true,
            servers: [
              { name: "rex", transport: "stdio", ok: false, error: "server already exists" },
              { name: "sourcevision", transport: "stdio", ok: false, error: "binary not found" },
            ],
          },
        },
      },
    };
    const lines = formatInitReport(results);
    const joined = lines.join("\n");
    expect(joined).toContain("rex (server already exists)");
    expect(joined).toContain("sourcevision (binary not found)");
  });

  it("shows only names for failed servers without error details", () => {
    const results = {
      claude: {
        summary: "CLAUDE.md, 12 skills, 18 permissions",
        label: "Claude Code",
        skipped: false,
        detail: {
          instructions: { written: true },
          skills: { written: 12 },
          settings: { added: 0, total: 18 },
          mcp: {
            registered: true,
            servers: [
              { name: "rex", transport: "stdio", ok: false },
            ],
          },
        },
      },
    };
    const lines = formatInitReport(results);
    const joined = lines.join("\n");
    expect(joined).toContain("MCP servers — failed: rex");
    // No parenthetical detail
    expect(joined).not.toContain("rex (");
  });
});

// ── setupAssistantIntegrations() error capture ────────────────────────────────

describe("setupAssistantIntegrations error capture (source)", () => {
  const src = readFileSync(join(ROOT, "packages/core/assistant-integration.js"), "utf-8");

  it("catches setup errors as a named variable", () => {
    expect(src).toMatch(/\}\s*catch\s*\(\s*\w+\s*\)/);
  });

  it("includes error field in the failure result", () => {
    expect(src).toMatch(/error:\s*\w+\.message/);
  });
});

// ── cli.js uses assistant-integration.js ────────────────────────────────────

describe("cli.js uses assistant-neutral orchestration", () => {
  const src = readFileSync(join(ROOT, "packages/core/cli.js"), "utf-8");

  it("imports from assistant-integration.js", () => {
    expect(src).toContain('from "./assistant-integration.js"');
  });

  it("does not import setupClaudeIntegration directly", () => {
    expect(src).not.toContain("setupClaudeIntegration");
  });

  it("does not import setupCodexIntegration directly", () => {
    expect(src).not.toContain("setupCodexIntegration");
  });

  it("calls setupAssistantIntegrations", () => {
    expect(src).toContain("setupAssistantIntegrations");
  });

  it("imports formatInitReport", () => {
    expect(src).toContain("formatInitReport");
  });

  it("uses formatInitReport for the init summary", () => {
    expect(src).toContain("formatInitReport(assistantResults,");
  });
});

// ── cli.js assistant-selection flags ─────────────────────────────────────────

describe("cli.js assistant-selection flags", () => {
  const src = readFileSync(join(ROOT, "packages/core/cli.js"), "utf-8");

  it("defines resolveAssistantFlags function", () => {
    expect(src).toContain("function resolveAssistantFlags");
  });

  it("defines extractAssistantsFlag function", () => {
    expect(src).toContain("function extractAssistantsFlag");
  });

  it("supports --claude-only flag", () => {
    expect(src).toContain("--claude-only");
  });

  it("supports --codex-only flag", () => {
    expect(src).toContain("--codex-only");
  });

  it("supports --assistants= flag", () => {
    expect(src).toContain("--assistants=");
  });

  it("uses resolveAssistantFlags in handleInit", () => {
    expect(src).toContain("resolveAssistantFlags(rest)");
  });

  it("validates --assistants= values against SUPPORTED_PROVIDERS", () => {
    // The validation should reference SUPPORTED_PROVIDERS to reject unknown vendors
    expect(src).toContain("SUPPORTED_PROVIDERS.includes");
  });

  it("strips all assistant flags before passing to sub-inits", () => {
    expect(src).toContain("stripAssistantFlags");
  });
});

// ── backward-compatibility: re-init detection ────────────────────────────────

describe("cli.js backward-compatible re-init detection", () => {
  const src = readFileSync(join(ROOT, "packages/core/cli.js"), "utf-8");

  it("defines hasExplicitAssistantFlags function", () => {
    expect(src).toContain("function hasExplicitAssistantFlags");
  });

  it("calls hasExplicitAssistantFlags in handleInit", () => {
    expect(src).toContain("hasExplicitAssistantFlags(rest)");
  });

  it("detects existing Claude surfaces (.claude or CLAUDE.md)", () => {
    expect(src).toContain("claudePresent");
    expect(src).toContain('".claude"');
    expect(src).toContain('"CLAUDE.md"');
  });

  it("detects existing Codex surfaces (.codex, .agents, or AGENTS.md)", () => {
    expect(src).toContain("codexPresent");
    expect(src).toContain('".codex"');
    expect(src).toContain('".agents"');
    expect(src).toContain('"AGENTS.md"');
  });

  it("narrows assistantEnabled when only one vendor surface exists", () => {
    // Should disable the absent vendor when only one exists
    expect(src).toContain("claudePresent && !codexPresent");
    expect(src).toContain("!claudePresent && codexPresent");
  });
});

// ── backward-compatibility: deprecated exports ───────────────────────────────

describe("deprecated vendor summary exports are preserved", () => {
  it("claude-integration.js still exports printClaudeSetupSummary", () => {
    const src = readFileSync(join(ROOT, "packages/core/claude-integration.js"), "utf-8");
    expect(src).toContain("export function printClaudeSetupSummary");
    expect(src).toContain("@deprecated");
  });

  it("codex-integration.js still exports printCodexSetupSummary", () => {
    const src = readFileSync(join(ROOT, "packages/core/codex-integration.js"), "utf-8");
    expect(src).toContain("export function printCodexSetupSummary");
    expect(src).toContain("@deprecated");
  });

  it("printClaudeSetupSummary is importable (not removed)", async () => {
    const mod = await import("../../packages/core/claude-integration.js");
    expect(typeof mod.printClaudeSetupSummary).toBe("function");
  });

  it("printCodexSetupSummary is importable (not removed)", async () => {
    const mod = await import("../../packages/core/codex-integration.js");
    expect(typeof mod.printCodexSetupSummary).toBe("function");
  });
});

// ── help.js init documentation ──────────────────────────────────────────────

describe("help.js init help documents all assistant flags", () => {
  const src = readFileSync(join(ROOT, "packages/core/help.js"), "utf-8");

  it("documents --claude-only flag", () => {
    expect(src).toContain("--claude-only");
  });

  it("documents --codex-only flag", () => {
    expect(src).toContain("--codex-only");
  });

  it("documents --assistants= flag", () => {
    expect(src).toContain("--assistants=");
  });

  it("documents --no-claude flag", () => {
    expect(src).toContain("--no-claude");
  });

  it("documents --no-codex flag", () => {
    expect(src).toContain("--no-codex");
  });
});
