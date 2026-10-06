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
  localizeEffects,
  expandLayoutTokens,
  LAYOUT_TOKENS,
} from "../../packages/core/command-effects.js";
import { getOrchestratorCommands } from "../../packages/core/help.js";

/** Conditions read as a clause after "only" — "only with --accept". */
const CONDITION = /^(with|without|when|on|for) /;

const NETWORK_KINDS = ["llm-provider", "remote", "localhost"];

describe("command effects declarations", () => {
  it("declares every command in the help registry", () => {
    const missing = getOrchestratorCommands().filter((name) => getCommandEffects(name) === null);
    expect(missing, "registry commands with no entry in COMMAND_EFFECTS").toEqual([]);
  });

  it("declares nothing the help registry does not list", () => {
    const registry = new Set(getOrchestratorCommands());
    const stray = Object.keys(COMMAND_EFFECTS).filter((name) => !registry.has(name));
    expect(stray, "declarations for commands the CLI does not have").toEqual([]);
  });

  it("returns null for a name that is not a command", () => {
    expect(getCommandEffects("no-such-command")).toBeNull();
    expect(resolveCommandEffects("no-such-command", [])).toBeNull();
    // Inherited object keys are not commands either.
    expect(getCommandEffects("toString")).toBeNull();
  });

  it("gives every declaration a complete shape", () => {
    for (const [name, effects] of Object.entries(COMMAND_EFFECTS)) {
      expect(effects.command, name).toBe(name);
      expect(effects.summary, name).toBeTruthy();
      // Empty is legitimate: `log` and `install-sample` consult nothing.
      expect(Array.isArray(effects.reads), name).toBe(true);
      expect(Array.isArray(effects.writes), name).toBe(true);
      expect(Array.isArray(effects.llm), name).toBe(true);
      expect(Array.isArray(effects.network), name).toBe(true);
      for (const net of effects.network) {
        expect(NETWORK_KINDS, `${name} network`).toContain(net.to);
        expect(net.what, `${name} network`).toBeTruthy();
        if (net.when !== undefined) expect(net.when, `${name} network`).toMatch(CONDITION);
      }
      for (const phase of effects.llm) {
        expect(phase.phase && phase.purpose && phase.calls, `${name} llm`).toBeTruthy();
      }
      expect(effects.duration, name).toBeTruthy();
      expect(effects.next, name).toMatch(/^ndx /);
    }
  });

  it("phrases every conditional write as a condition", () => {
    for (const [name, effects] of Object.entries(COMMAND_EFFECTS)) {
      for (const write of effects.writes) {
        if (write.conditional) expect(write.when, `${name} → ${write.path}`).toMatch(CONDITION);
      }
    }
  });

  it("names the LLM provider in network whenever a phase calls a model", () => {
    for (const [name, effects] of Object.entries(COMMAND_EFFECTS)) {
      const talksToProvider = effects.network.some((n) => n.to === "llm-provider");
      expect(talksToProvider, name).toBe(effects.llm.length > 0);
    }
  });

  it("declares recommend as making no model calls", () => {
    // Recommendations are grouped from findings deterministically. If that ever
    // changes, this declaration must change with it — the banner promising a
    // free command that then spends money is the failure this guards.
    expect(COMMAND_EFFECTS.recommend.llm).toEqual([]);
    expect(COMMAND_EFFECTS.recommend.network).toEqual([]);
  });

  it("declares aliases with their target's effects", () => {
    for (const [aliasName, target] of [["web", "start"], ["bicker", "pair-programming"], ["sv", "sourcevision"]]) {
      const { command: _a, ...aliasRest } = COMMAND_EFFECTS[aliasName];
      const { command: _t, ...targetRest } = COMMAND_EFFECTS[target];
      if (aliasName === "sv") {
        expect(aliasRest.delegates).toBe(targetRest.delegates);
      } else {
        expect(aliasRest, aliasName).toEqual(targetRest);
      }
    }
  });
});

describe("resolveCommandEffects", () => {
  it("keeps the declared LLM phases by default", () => {
    const effects = resolveCommandEffects("analyze", []);
    expect(effects.llm.length).toBeGreaterThan(0);
    expect(effects.network.map((n) => n.to)).toContain("llm-provider");
  });

  it("drops analyze's LLM phases under --fast", () => {
    const effects = resolveCommandEffects("analyze", ["--fast", "--deep"]);
    expect(effects.llm).toEqual([]);
    expect(effects.network).toEqual([]);
  });

  it("keeps analyze's LLM phases under --no-llm, which sourcevision ignores", () => {
    // Regression: the banner used to promise "no model calls" here while
    // `sourcevision analyze` dropped the flag and called the model anyway.
    expect(resolveCommandEffects("analyze", ["--no-llm"]).llm.length).toBeGreaterThan(0);
  });

  it("drops plan's LLM phases under --no-llm and keeps them under --fast", () => {
    // `ndx plan --no-llm` silences both halves; `--fast` reaches only rex,
    // which ignores it.
    expect(resolveCommandEffects("plan", ["--no-llm"]).llm).toEqual([]);
    expect(resolveCommandEffects("plan", ["--fast"]).llm.length).toBeGreaterThan(0);
  });

  it("keeps non-LLM network under a no-LLM flag", () => {
    const effects = resolveCommandEffects("refresh", ["--fast", "--live-server"]);
    expect(effects.llm).toEqual([]);
    expect(effects.network.map((n) => n.to)).toEqual(["localhost"]);
  });

  it("does not mutate the declaration it derives from", () => {
    resolveCommandEffects("plan", ["--no-llm"]);
    expect(COMMAND_EFFECTS.plan.llm.length).toBeGreaterThan(0);
    expect(COMMAND_EFFECTS.plan.network.length).toBeGreaterThan(0);
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

describe("localizeEffects", () => {
  const LEGACY = { rex: ".rex", hench: ".hench", sourcevision: ".sourcevision", config: ".n-dx.json" };
  const NDX = { rex: ".ndx/rex", hench: ".ndx/hench", sourcevision: ".ndx/sourcevision", config: ".ndx/config.json" };

  it("names no layout-owned path literally — every one is a token", () => {
    // A literal `.rex/` is wrong on a `.ndx/` project, silently: the banner
    // names a folder nothing writes and the run summary checks it.
    const text = JSON.stringify(COMMAND_EFFECTS);
    expect(text).not.toMatch(/\.(rex|hench|sourcevision)\/|\.n-dx[\w.-]*\.(json|pid|port)/);
  });

  it("expands tokens to the project's own layout", () => {
    expect(localizeEffects(COMMAND_EFFECTS.plan, LEGACY).writes.map((w) => w.path)).toContain(".rex/prd_tree/");
    expect(localizeEffects(COMMAND_EFFECTS.plan, NDX).writes.map((w) => w.path)).toContain(".ndx/rex/prd_tree/");
    expect(localizeEffects(COMMAND_EFFECTS.analyze, NDX).writes[0].path).toBe(".ndx/sourcevision/");
  });

  it("leaves an unknown token as written and does not touch the declaration", () => {
    expect(expandLayoutTokens("{nope}/x", LEGACY)).toBe("{nope}/x");
    localizeEffects(COMMAND_EFFECTS.plan, LEGACY);
    expect(COMMAND_EFFECTS.plan.writes.map((w) => w.path)).toContain("{rex}/prd_tree/");
  });

  it("declares a resolveLayout field for every token", () => {
    expect(Object.values(LAYOUT_TOKENS).every((f) => f.endsWith("Dir") || f.endsWith("File"))).toBe(true);
  });
});

describe("formatPreflightBanner", () => {
  const LEGACY = { rex: ".rex", hench: ".hench", sourcevision: ".sourcevision", config: ".n-dx.json" };

  it("names the command, what it reads, what it writes and what it costs", () => {
    const text = formatPreflightBanner(localizeEffects(COMMAND_EFFECTS.analyze, LEGACY)).join("\n");
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

  it("says a command reads nothing when it declares no reads", () => {
    expect(formatPreflightBanner(COMMAND_EFFECTS.log).join("\n")).toMatch(/reads\s+nothing/);
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
