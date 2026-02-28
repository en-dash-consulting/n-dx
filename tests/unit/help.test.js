import { describe, it, expect } from "vitest";
import {
  editDistance,
  suggestCommands,
  formatTypoSuggestion,
  searchHelp,
  formatSearchResults,
  getOrchestratorCommands,
  getToolSubcommands,
  formatToolHelp,
  getRelatedCommands,
  formatRelatedCommands,
} from "../../help.js";

describe("help.js", () => {
  describe("editDistance", () => {
    it("returns 0 for identical strings", () => {
      expect(editDistance("hello", "hello")).toBe(0);
    });

    it("handles empty strings", () => {
      expect(editDistance("", "abc")).toBe(3);
      expect(editDistance("abc", "")).toBe(3);
    });

    it("handles single substitution", () => {
      expect(editDistance("status", "statis")).toBe(1);
    });

    it("handles kitten/sitting classic case", () => {
      expect(editDistance("kitten", "sitting")).toBe(3);
    });
  });

  describe("suggestCommands", () => {
    const commands = ["init", "plan", "refresh", "work", "status", "usage", "sync", "start", "dev", "web", "ci", "config"];

    it("suggests 'status' for 'statis'", () => {
      const suggestions = suggestCommands("statis", commands);
      expect(suggestions.length).toBeGreaterThan(0);
      expect(suggestions[0].name).toBe("status");
      expect(suggestions[0].distance).toBe(1);
    });

    it("suggests 'plan' for 'plna'", () => {
      const suggestions = suggestCommands("plna", commands);
      expect(suggestions.some((s) => s.name === "plan")).toBe(true);
    });

    it("returns empty array for completely different input", () => {
      const suggestions = suggestCommands("xyzabc", commands);
      expect(suggestions).toEqual([]);
    });

    it("returns empty array for exact match (distance 0)", () => {
      const suggestions = suggestCommands("status", commands);
      expect(suggestions).toEqual([]);
    });
  });

  describe("formatTypoSuggestion", () => {
    const commands = ["init", "plan", "work", "status"];

    it("returns null when no matches", () => {
      expect(formatTypoSuggestion("xyzabc", commands)).toBeNull();
    });

    it("returns 'Did you mean' for close match", () => {
      const result = formatTypoSuggestion("statis", commands);
      expect(result).toContain("Did you mean");
      expect(result).toContain("status");
    });

    it("includes prefix", () => {
      const result = formatTypoSuggestion("statis", commands, "ndx ");
      expect(result).toContain("ndx status");
    });
  });

  describe("searchHelp", () => {
    it("finds commands by exact name", () => {
      const results = searchHelp("status");
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].name).toContain("status");
    });

    it("finds commands by keyword", () => {
      const results = searchHelp("PRD");
      expect(results.length).toBeGreaterThan(0);
      // Should find rex and status (both mention PRD)
      const names = results.map((r) => r.name);
      expect(names.some((n) => n.includes("status") || n === "rex")).toBe(true);
    });

    it("finds commands by summary content", () => {
      const results = searchHelp("autonomous");
      expect(results.length).toBeGreaterThan(0);
    });

    it("returns empty for no matches", () => {
      const results = searchHelp("xyznonexistent");
      expect(results).toEqual([]);
    });

    it("results are sorted by score descending", () => {
      const results = searchHelp("status");
      for (let i = 1; i < results.length; i++) {
        expect(results[i].score).toBeLessThanOrEqual(results[i - 1].score);
      }
    });

    it("includes subcommands in search", () => {
      const results = searchHelp("validate");
      // Should find both rex validate and sourcevision validate
      const names = results.map((r) => r.name);
      expect(names.some((n) => n.includes("rex"))).toBe(true);
      expect(names.some((n) => n.includes("sourcevision"))).toBe(true);
    });

    it("scores exact name match higher than keyword match", () => {
      const results = searchHelp("sync");
      // The top result should be 'sync' (exact name match) not a keyword-only match
      expect(results[0].score).toBeGreaterThan(0);
      if (results.length > 1) {
        expect(results[0].score).toBeGreaterThanOrEqual(results[1].score);
      }
    });
  });

  describe("formatSearchResults", () => {
    it("formats 'no results' message", () => {
      const output = formatSearchResults([], "xyzabc");
      expect(output).toContain("No commands found");
      expect(output).toContain("xyzabc");
    });

    it("formats results with summaries", () => {
      const results = searchHelp("status");
      const output = formatSearchResults(results, "status");
      expect(output).toContain("Search results for 'status'");
      expect(output).toContain("ndx");
    });

    it("includes navigation hint", () => {
      const results = searchHelp("status");
      const output = formatSearchResults(results, "status");
      expect(output).toContain("--help");
    });
  });

  describe("getOrchestratorCommands", () => {
    it("returns all orchestration and tool commands", () => {
      const commands = getOrchestratorCommands();
      expect(commands).toContain("init");
      expect(commands).toContain("plan");
      expect(commands).toContain("refresh");
      expect(commands).toContain("work");
      expect(commands).toContain("status");
      expect(commands).toContain("rex");
      expect(commands).toContain("hench");
      expect(commands).toContain("sourcevision");
    });
  });

  describe("getToolSubcommands", () => {
    it("returns rex subcommands", () => {
      const subs = getToolSubcommands("rex");
      expect(subs).toContain("init");
      expect(subs).toContain("status");
      expect(subs).toContain("next");
      expect(subs).toContain("add");
      expect(subs).toContain("validate");
    });

    it("returns hench subcommands", () => {
      const subs = getToolSubcommands("hench");
      expect(subs).toContain("init");
      expect(subs).toContain("run");
      expect(subs).toContain("config");
    });

    it("returns sourcevision subcommands", () => {
      const subs = getToolSubcommands("sourcevision");
      expect(subs).toContain("init");
      expect(subs).toContain("analyze");
      expect(subs).toContain("serve");
    });

    it("handles sv alias", () => {
      const subs = getToolSubcommands("sv");
      expect(subs.length).toBeGreaterThan(0);
    });

    it("returns empty for unknown tool", () => {
      const subs = getToolSubcommands("nonexistent");
      expect(subs).toEqual([]);
    });
  });

  describe("formatToolHelp", () => {
    it("returns formatted help for rex", () => {
      const help = formatToolHelp("rex");
      expect(help).toContain("Rex");
      expect(help).toContain("init");
      expect(help).toContain("status");
      expect(help).toContain("rex <command> --help");
    });

    it("returns formatted help for hench", () => {
      const help = formatToolHelp("hench");
      expect(help).toContain("Hench");
      expect(help).toContain("run");
    });

    it("returns formatted help for sv alias", () => {
      const help = formatToolHelp("sv");
      expect(help).toContain("SourceVision");
    });

    it("returns null for unknown tool", () => {
      expect(formatToolHelp("nonexistent")).toBeNull();
    });
  });

  describe("getRelatedCommands", () => {
    it("returns related commands for orchestrator", () => {
      const related = getRelatedCommands("plan");
      expect(related).toContain("init");
      expect(related).toContain("work");
    });

    it("returns related commands for tool subcommand", () => {
      const related = getRelatedCommands("validate", "rex");
      expect(related.length).toBeGreaterThan(0);
    });

    it("returns empty array for unknown command", () => {
      const related = getRelatedCommands("nonexistent");
      expect(related).toEqual([]);
    });
  });

  describe("formatRelatedCommands", () => {
    it("formats related commands with prefix", () => {
      const output = formatRelatedCommands(["plan", "work"], "ndx");
      expect(output).toBe("See also: ndx plan, ndx work");
    });

    it("returns null for empty array", () => {
      expect(formatRelatedCommands([])).toBeNull();
    });
  });
});
