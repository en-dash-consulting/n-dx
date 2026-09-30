/**
 * Unit tests for the command effects declarations and the preflight gate.
 *
 * The gate is tested here rather than end-to-end because its deciding input is
 * whether stdout is a terminal, and the suite has no pty. `shouldShowPreflight`
 * therefore takes the TTY flag as an argument instead of reading
 * `process.stdout` — the whole reason it is a pure function. The e2e side of
 * the same behaviour (the banner reaching stderr, stdout staying byte-identical
 * under --format=json) lives in tests/e2e/cli-preflight-banner.test.js.
 */

import { describe, it, expect } from "vitest";
import {
  COMMAND_EFFECTS,
  getCommandEffects,
  resolveCommandEffects,
  shouldShowPreflight,
  formatPreflightBanner,
} from "../../packages/core/command-effects.js";

describe("command effects declarations", () => {
  it("declares analyze, plan and recommend", () => {
    expect(Object.keys(COMMAND_EFFECTS).sort()).toEqual(["analyze", "plan", "recommend"]);
  });

  it("returns null for a command that has no declaration yet", () => {
    // Readers must tolerate this: the map is partial until every command is
    // declared, and a missing entry means "no banner", not "error".
    expect(getCommandEffects("status")).toBeNull();
    expect(resolveCommandEffects("status", [])).toBeNull();
  });

  it("gives every declaration a complete shape", () => {
    for (const [name, effects] of Object.entries(COMMAND_EFFECTS)) {
      expect(effects.command, name).toBe(name);
      expect(effects.summary, name).toBeTruthy();
      expect(effects.reads.length, name).toBeGreaterThan(0);
      expect(Array.isArray(effects.writes), name).toBe(true);
      expect(Array.isArray(effects.llm), name).toBe(true);
      expect(["none", "llm-provider"], name).toContain(effects.network);
      expect(effects.duration, name).toBeTruthy();
      expect(effects.next, name).toMatch(/^ndx /);
    }
  });

  it("marks every conditional write with the flag that turns it on", () => {
    for (const [name, effects] of Object.entries(COMMAND_EFFECTS)) {
      for (const write of effects.writes) {
        if (write.conditional) expect(write.when, `${name} → ${write.path}`).toMatch(/^--/);
      }
    }
  });

  it("declares recommend as making no model calls", () => {
    // Recommendations are grouped from findings deterministically. If that ever
    // changes, this declaration must change with it — the banner promising a
    // free command that then spends money is the failure this guards.
    expect(COMMAND_EFFECTS.recommend.llm).toEqual([]);
    expect(COMMAND_EFFECTS.recommend.network).toBe("none");
  });
});

describe("resolveCommandEffects", () => {
  it("keeps the declared LLM phases by default", () => {
    expect(resolveCommandEffects("analyze", []).llm.length).toBeGreaterThan(0);
    expect(resolveCommandEffects("analyze", []).network).toBe("llm-provider");
  });

  for (const flag of ["--no-llm", "--fast"]) {
    it(`drops the LLM phases under ${flag}`, () => {
      const effects = resolveCommandEffects("analyze", [flag, "--deep"]);
      expect(effects.llm).toEqual([]);
      expect(effects.network).toBe("none");
    });
  }

  it("does not mutate the declaration it derives from", () => {
    resolveCommandEffects("plan", ["--no-llm"]);
    expect(COMMAND_EFFECTS.plan.llm.length).toBeGreaterThan(0);
  });
});

describe("shouldShowPreflight", () => {
  const tty = { isTTY: true, env: {} };

  it("shows on an interactive terminal with no suppressing flag", () => {
    expect(shouldShowPreflight([], tty)).toBe(true);
    expect(shouldShowPreflight(["--deep"], tty)).toBe(true);
  });

  it("does not show when stdout is not a terminal", () => {
    // This is the autonomous case: `ndx work` spawns its children with pipes.
    expect(shouldShowPreflight([], { isTTY: false, env: {} })).toBe(false);
    expect(shouldShowPreflight([], { env: {} })).toBe(false);
  });

  for (const flag of ["--yes", "-y", "--quiet", "-q", "--format=json", "--json"]) {
    it(`does not show under ${flag}, even on a terminal`, () => {
      expect(shouldShowPreflight([flag], tty)).toBe(false);
    });
  }

  it("lets a suppressing flag beat NDX_PREFLIGHT=always", () => {
    // Precedence matters: --yes is an explicit answer to the pause, so it wins
    // over an environment default that merely asks to see banners.
    expect(shouldShowPreflight(["--yes"], { isTTY: true, env: { NDX_PREFLIGHT: "always" } })).toBe(false);
  });

  it("honours NDX_PREFLIGHT over TTY detection in both directions", () => {
    expect(shouldShowPreflight([], { isTTY: false, env: { NDX_PREFLIGHT: "always" } })).toBe(true);
    expect(shouldShowPreflight([], { isTTY: false, env: { NDX_PREFLIGHT: "1" } })).toBe(true);
    expect(shouldShowPreflight([], { isTTY: true, env: { NDX_PREFLIGHT: "never" } })).toBe(false);
    expect(shouldShowPreflight([], { isTTY: true, env: { NDX_PREFLIGHT: "0" } })).toBe(false);
  });

  it("does not show in CI", () => {
    expect(shouldShowPreflight([], { isTTY: true, env: { CI: "true" } })).toBe(false);
  });

  it("lets NDX_PREFLIGHT=always override CI", () => {
    expect(shouldShowPreflight([], { isTTY: false, env: { CI: "true", NDX_PREFLIGHT: "always" } })).toBe(true);
  });
});

describe("formatPreflightBanner", () => {
  it("names the command, what it reads, what it writes and what it costs", () => {
    const text = formatPreflightBanner(COMMAND_EFFECTS.analyze).join("\n");
    expect(text).toContain("ndx analyze");
    expect(text).toContain("reads");
    expect(text).toContain(".sourcevision/");
    expect(text).toContain("zones");
    expect(text).toContain("Ctrl-C");
    expect(text).toContain("--yes");
  });

  it("says a command is read-only when it declares no unconditional write", () => {
    const readOnly = { ...COMMAND_EFFECTS.recommend, writes: [] };
    expect(formatPreflightBanner(readOnly).join("\n")).toContain("read-only");
  });

  it("says so plainly when no model is called", () => {
    expect(formatPreflightBanner(COMMAND_EFFECTS.recommend).join("\n")).toContain("no model calls");
  });

  it("names the flag a conditional write depends on", () => {
    expect(formatPreflightBanner(COMMAND_EFFECTS.plan).join("\n")).toContain("only with --accept");
  });

  it("emits no ANSI when given no colour functions", () => {
    for (const effects of Object.values(COMMAND_EFFECTS)) {
      expect(formatPreflightBanner(effects).join("\n")).not.toMatch(/\x1b\[/);
    }
  });

  it("applies the caller's colour functions", () => {
    const text = formatPreflightBanner(COMMAND_EFFECTS.analyze, {
      bold: (t) => `<b>${t}</b>`,
    }).join("\n");
    expect(text).toContain("<b>ndx analyze</b>");
  });
});
