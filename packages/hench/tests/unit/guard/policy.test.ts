import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { PolicyEngine, DEFAULT_POLICY_LIMITS } from "../../../src/guard/policy.js";
import { GuardError } from "../../../src/guard/paths.js";

describe("PolicyEngine", () => {
  let engine: PolicyEngine;

  beforeEach(() => {
    vi.useFakeTimers();
    engine = new PolicyEngine();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("session counters", () => {
    it("starts with zero counters", () => {
      expect(engine.counters).toEqual({
        commandsRun: 0,
        bytesWritten: 0,
        filesRead: 0,
        filesWritten: 0,
        operationsTotal: 0,
      });
    });

    it("increments command counter on command operations", () => {
      engine.checkPolicy("command", "npm test");
      expect(engine.counters.commandsRun).toBe(1);
      expect(engine.counters.operationsTotal).toBe(1);
    });

    it("increments command counter on git operations", () => {
      engine.checkPolicy("git", "git status");
      expect(engine.counters.commandsRun).toBe(1);
    });

    it("tracks bytes written", () => {
      engine.checkPolicy("file_write", "src/foo.ts", { bytesWritten: 500 });
      expect(engine.counters.bytesWritten).toBe(500);
      expect(engine.counters.filesWritten).toBe(1);

      engine.checkPolicy("file_write", "src/bar.ts", { bytesWritten: 300 });
      expect(engine.counters.bytesWritten).toBe(800);
      expect(engine.counters.filesWritten).toBe(2);
    });

    it("tracks file reads", () => {
      engine.checkPolicy("file_read", "src/foo.ts");
      engine.checkPolicy("file_read", "src/bar.ts");
      expect(engine.counters.filesRead).toBe(2);
    });

    it("tracks total operations across all types", () => {
      engine.checkPolicy("command", "npm test");
      engine.checkPolicy("file_read", "src/foo.ts");
      engine.checkPolicy("file_write", "src/bar.ts", { bytesWritten: 100 });
      engine.checkPolicy("git", "git status");
      engine.checkPolicy("path_check", "src/baz.ts");
      engine.checkPolicy("directory_list", "src/");
      engine.checkPolicy("file_search", "pattern");
      expect(engine.counters.operationsTotal).toBe(7);
    });
  });

  describe("command rate limiting", () => {
    it("allows commands within rate limit", () => {
      const engine = new PolicyEngine({ maxCommandsPerMinute: 5 });
      for (let i = 0; i < 5; i++) {
        expect(() => engine.checkPolicy("command", `cmd-${i}`)).not.toThrow();
      }
    });

    it("denies commands exceeding rate limit", () => {
      const engine = new PolicyEngine({ maxCommandsPerMinute: 3 });
      engine.checkPolicy("command", "cmd-1");
      engine.checkPolicy("command", "cmd-2");
      engine.checkPolicy("command", "cmd-3");

      expect(() => engine.checkPolicy("command", "cmd-4")).toThrow(GuardError);
      expect(() => engine.checkPolicy("command", "cmd-4")).toThrow(/Rate limit exceeded/);
    });

    it("includes git operations in command rate limit", () => {
      const engine = new PolicyEngine({ maxCommandsPerMinute: 2 });
      engine.checkPolicy("command", "npm test");
      engine.checkPolicy("git", "git status");

      expect(() => engine.checkPolicy("command", "npm build")).toThrow(GuardError);
    });

    it("allows commands after rate limit window expires", () => {
      const engine = new PolicyEngine({ maxCommandsPerMinute: 2, rateLimitWindowMs: 60_000 });
      engine.checkPolicy("command", "cmd-1");
      engine.checkPolicy("command", "cmd-2");

      // Should be blocked now
      expect(() => engine.checkPolicy("command", "cmd-3")).toThrow(GuardError);

      // Advance time past the window
      vi.advanceTimersByTime(61_000);

      // Should be allowed again
      expect(() => engine.checkPolicy("command", "cmd-4")).not.toThrow();
    });

    it("uses sliding window (partial expiry)", () => {
      const engine = new PolicyEngine({ maxCommandsPerMinute: 3, rateLimitWindowMs: 60_000 });

      // t=0: command 1
      engine.checkPolicy("command", "cmd-1");

      // t=30s: command 2
      vi.advanceTimersByTime(30_000);
      engine.checkPolicy("command", "cmd-2");

      // t=40s: command 3
      vi.advanceTimersByTime(10_000);
      engine.checkPolicy("command", "cmd-3");

      // t=40s: blocked (3 commands in last 60s)
      expect(() => engine.checkPolicy("command", "cmd-4")).toThrow(GuardError);

      // t=61s: command 1 expires, 2 and 3 still in window
      vi.advanceTimersByTime(21_000);
      expect(() => engine.checkPolicy("command", "cmd-5")).not.toThrow();
    });

    it("skips rate limiting when maxCommandsPerMinute is 0 (unlimited)", () => {
      const engine = new PolicyEngine({ maxCommandsPerMinute: 0 });
      // Should not throw even with many commands
      for (let i = 0; i < 100; i++) {
        expect(() => engine.checkPolicy("command", `cmd-${i}`)).not.toThrow();
      }
    });
  });

  describe("write rate limiting", () => {
    it("denies writes exceeding rate limit", () => {
      const engine = new PolicyEngine({ maxWritesPerMinute: 2 });
      engine.checkPolicy("file_write", "a.ts", { bytesWritten: 10 });
      engine.checkPolicy("file_write", "b.ts", { bytesWritten: 10 });

      expect(() => engine.checkPolicy("file_write", "c.ts", { bytesWritten: 10 })).toThrow(GuardError);
      expect(() => engine.checkPolicy("file_write", "c.ts", { bytesWritten: 10 })).toThrow(/Rate limit exceeded/);
    });

    it("allows writes after rate limit window expires", () => {
      const engine = new PolicyEngine({ maxWritesPerMinute: 1, rateLimitWindowMs: 60_000 });
      engine.checkPolicy("file_write", "a.ts", { bytesWritten: 10 });

      expect(() => engine.checkPolicy("file_write", "b.ts", { bytesWritten: 10 })).toThrow(GuardError);

      vi.advanceTimersByTime(61_000);
      expect(() => engine.checkPolicy("file_write", "c.ts", { bytesWritten: 10 })).not.toThrow();
    });
  });

  describe("cumulative byte limit", () => {
    it("denies writes exceeding total byte limit", () => {
      const engine = new PolicyEngine({ maxTotalBytesWritten: 100 });
      engine.checkPolicy("file_write", "a.ts", { bytesWritten: 60 });

      expect(() => engine.checkPolicy("file_write", "b.ts", { bytesWritten: 50 })).toThrow(GuardError);
      expect(() => engine.checkPolicy("file_write", "b.ts", { bytesWritten: 50 })).toThrow(/Session limit exceeded/);
    });

    it("allows writes within total byte limit", () => {
      const engine = new PolicyEngine({ maxTotalBytesWritten: 100 });
      engine.checkPolicy("file_write", "a.ts", { bytesWritten: 40 });
      engine.checkPolicy("file_write", "b.ts", { bytesWritten: 40 });
      expect(engine.counters.bytesWritten).toBe(80);
    });

    it("skips byte limit when maxTotalBytesWritten is 0 (unlimited)", () => {
      const engine = new PolicyEngine({ maxTotalBytesWritten: 0 });
      engine.checkPolicy("file_write", "a.ts", { bytesWritten: 10_000_000 });
      expect(engine.counters.bytesWritten).toBe(10_000_000);
    });
  });

  describe("cumulative command limit", () => {
    it("denies commands exceeding total command limit", () => {
      const engine = new PolicyEngine({ maxTotalCommands: 3 });
      engine.checkPolicy("command", "cmd-1");
      engine.checkPolicy("command", "cmd-2");
      engine.checkPolicy("command", "cmd-3");

      expect(() => engine.checkPolicy("command", "cmd-4")).toThrow(GuardError);
      expect(() => engine.checkPolicy("command", "cmd-4")).toThrow(/Session limit exceeded/);
    });

    it("does not reset with time (unlike rate limits)", () => {
      const engine = new PolicyEngine({ maxTotalCommands: 2, maxCommandsPerMinute: 0 });
      engine.checkPolicy("command", "cmd-1");
      engine.checkPolicy("command", "cmd-2");

      vi.advanceTimersByTime(120_000);
      expect(() => engine.checkPolicy("command", "cmd-3")).toThrow(GuardError);
    });
  });

  describe("audit trail", () => {
    it("records allowed operations", () => {
      engine.checkPolicy("command", "npm test");
      expect(engine.auditLog).toHaveLength(1);
      expect(engine.auditLog[0].verdict).toBe("allow");
      expect(engine.auditLog[0].operation).toBe("command");
      expect(engine.auditLog[0].target).toBe("npm test");
    });

    it("records denied operations", () => {
      const engine = new PolicyEngine({ maxCommandsPerMinute: 1 });
      engine.checkPolicy("command", "cmd-1");

      try {
        engine.checkPolicy("command", "cmd-2");
      } catch {
        // expected
      }

      expect(engine.auditLog).toHaveLength(2);
      expect(engine.auditLog[0].verdict).toBe("allow");
      expect(engine.auditLog[1].verdict).toBe("deny");
      expect(engine.auditLog[1].reason).toContain("Rate limit exceeded");
    });

    it("includes counters at time of each entry", () => {
      engine.checkPolicy("command", "cmd-1");
      engine.checkPolicy("command", "cmd-2");

      expect(engine.auditLog[0].counters.commandsRun).toBe(1);
      expect(engine.auditLog[1].counters.commandsRun).toBe(2);
    });

    it("provides audit summary with denial details", () => {
      const engine = new PolicyEngine({ maxCommandsPerMinute: 1 });
      engine.checkPolicy("command", "cmd-1");

      try { engine.checkPolicy("command", "cmd-2"); } catch { /* expected */ }

      const summary = engine.auditSummary();
      expect(summary.total).toBe(2);
      expect(summary.allowed).toBe(1);
      expect(summary.denied).toBe(1);
      expect(summary.denials).toHaveLength(1);
      expect(summary.denials[0].target).toBe("cmd-2");
    });
  });

  describe("default limits", () => {
    it("has sensible defaults", () => {
      expect(DEFAULT_POLICY_LIMITS.maxCommandsPerMinute).toBe(60);
      expect(DEFAULT_POLICY_LIMITS.maxWritesPerMinute).toBe(30);
      expect(DEFAULT_POLICY_LIMITS.maxTotalBytesWritten).toBe(0);
      expect(DEFAULT_POLICY_LIMITS.maxTotalCommands).toBe(0);
      expect(DEFAULT_POLICY_LIMITS.rateLimitWindowMs).toBe(60_000);
    });

    it("merges partial overrides with defaults", () => {
      const engine = new PolicyEngine({ maxCommandsPerMinute: 10 });
      // Should not throw with default write limit
      for (let i = 0; i < 10; i++) {
        engine.checkPolicy("file_write", `file-${i}.ts`, { bytesWritten: 10 });
      }
    });
  });
});

describe("PolicyEngine.runAudit", () => {
  it("is the audit summary plus counters, in the run record's shape", () => {
    const engine = new PolicyEngine({ maxCommandsPerMinute: 1 });
    engine.checkPolicy("command", "npm test");
    expect(() => engine.checkPolicy("command", "npm run build")).toThrow();
    engine.checkPolicy("file_write", "a.ts", { bytesWritten: 10 });

    const audit = engine.runAudit();
    expect(audit).toMatchObject({ total: 3, allowed: 2, denied: 1 });
    expect(audit.denials).toHaveLength(1);
    expect(audit.denials[0]).toMatchObject({ operation: "command", target: "npm run build" });
    expect(audit.denials[0].reason).toMatch(/Rate limit/);
    // Per-entry counter snapshots are left off the record.
    expect("counters" in audit.denials[0]).toBe(false);
    expect(audit.counters).toEqual({ commandsRun: 1, bytesWritten: 10, filesRead: 0, filesWritten: 1, operationsTotal: 2 });
    expect(audit.denialsDropped).toBeUndefined();
  });

  it("keeps only the most recent denials and counts the rest", () => {
    const engine = new PolicyEngine({ maxTotalCommands: 1, maxCommandsPerMinute: 0 });
    engine.checkPolicy("command", "ok");
    for (let i = 0; i < 5; i++) expect(() => engine.checkPolicy("command", `c${i}`)).toThrow();

    const audit = engine.runAudit(2);
    expect(audit.denials.map((d) => d.target)).toEqual(["c3", "c4"]);
    expect(audit.denialsDropped).toBe(3);
  });
});
