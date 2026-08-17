/**
 * Vendor-CLI invocation log: behaviour + cross-package parity.
 *
 * `cli-log` is intentionally duplicated between two packages (the orchestration
 * tier must not import @n-dx/llm-client — spawn-only rule):
 *   - packages/llm-client/src/cli-log.ts  (canonical)
 *   - packages/core/cli-log.js            (core-side twin)
 *
 * Both twins are imported from SOURCE so the parity assertions cannot fail
 * because of a stale `dist/` — the same trap that produced a phantom quoting
 * divergence in tests/unit/windows-quoting-parity.test.js.
 */
import { readFileSync, existsSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";

import * as llm from "../../packages/llm-client/src/cli-log.ts";
import * as core from "../../packages/core/cli-log.js";

const TWINS = [
  ["llm-client", llm],
  ["core", core],
];

const tmpDirs = [];
function scratch() {
  const d = mkdtempSync(join(tmpdir(), "ndx-cli-log-"));
  tmpDirs.push(d);
  return d;
}

afterEach(() => {
  while (tmpDirs.length) {
    try {
      rmSync(tmpDirs.pop(), { recursive: true, force: true });
    } catch { /* best effort */ }
  }
});

describe.each(TWINS)("cli-log (%s twin)", (_name, mod) => {
  it("is enabled by default and opts out on NDX_CLI_LOG=0/false/no", () => {
    expect(mod.isCliLogEnabled({})).toBe(true);
    for (const v of ["0", "false", "no"]) {
      expect(mod.isCliLogEnabled({ NDX_CLI_LOG: v })).toBe(false);
    }
    // Any other value stays enabled — this is opt-OUT, not opt-in.
    expect(mod.isCliLogEnabled({ NDX_CLI_LOG: "1" })).toBe(true);
  });

  it("prefers NDX_CLI_LOG_PATH over the cwd default", () => {
    expect(mod.resolveCliLogPath({ NDX_CLI_LOG_PATH: "/custom/x.log" }, "/proj")).toBe("/custom/x.log");
    expect(mod.resolveCliLogPath({}, "/proj")).toBe(join("/proj", "claude_commands.log"));
  });

  it("derives a vendor label from bare names, shims, and absolute paths", () => {
    expect(mod.vendorFromBinary("claude")).toBe("claude");
    expect(mod.vendorFromBinary("claude.CMD")).toBe("claude");
    expect(mod.vendorFromBinary("C:\\Program Files\\claude\\claude.cmd")).toBe("claude");
    expect(mod.vendorFromBinary("/usr/local/bin/codex")).toBe("codex");
    expect(mod.vendorFromBinary("rex")).toBe("rex");
  });

  it("redacts secret-shaped tokens and values after secret flags", () => {
    expect(mod.redactArgs(["--api-key", "sk-ant-abc123"])).toEqual(["--api-key", "<redacted>"]);
    expect(mod.redactArgs(["--api-key=sk-ant-abc123"])).toEqual(["--api-key=<redacted>"]);
    expect(mod.redactArgs(["sk-ant-api03-XXXXXXXXXXXX"])).toEqual(["<redacted>"]);
    expect(mod.redactArgs(["ghp_0123456789abcdefghij"])).toEqual(["<redacted>"]);
    // Ordinary argv survives untouched.
    expect(mod.redactArgs(["-p", "--output-format", "json"])).toEqual(["-p", "--output-format", "json"]);
  });

  it("writes exactly one parseable JSONL line per invocation", () => {
    const dir = scratch();
    const path = join(dir, "log.jsonl");
    const env = { NDX_CLI_LOG_PATH: path };

    mod.logCliInvocation({ binary: "claude", args: ["-p", "hi"], cwd: dir, via: "spawnCli" }, env);
    mod.logCliInvocation({ binary: "codex", args: ["exec", "-"], via: "spawnCli" }, env);

    const lines = readFileSync(path, "utf-8").trim().split("\n");
    expect(lines).toHaveLength(2);

    const first = JSON.parse(lines[0]);
    expect(first.vendor).toBe("claude");
    expect(first.args).toEqual(["-p", "hi"]);
    expect(first.via).toBe("spawnCli");
    expect(first.cwd).toBe(dir);
    expect(typeof first.ts).toBe("string");

    expect(JSON.parse(lines[1]).vendor).toBe("codex");
  });

  it("writes nothing when disabled", () => {
    const dir = scratch();
    const path = join(dir, "log.jsonl");
    mod.logCliInvocation({ binary: "claude", args: ["-p"] }, { NDX_CLI_LOG_PATH: path, NDX_CLI_LOG: "0" });
    expect(existsSync(path)).toBe(false);
  });

  it("rotates to .1 once the log exceeds the size cap", () => {
    const dir = scratch();
    const path = join(dir, "log.jsonl");
    const env = { NDX_CLI_LOG_PATH: path };

    writeFileSync(path, "x".repeat(mod.CLI_LOG_MAX_BYTES + 1));
    mod.logCliInvocation({ binary: "claude", args: ["-p"] }, env);

    expect(existsSync(`${path}.1`)).toBe(true);
    // The fresh log holds only the new record, not the pre-rotation bulk.
    expect(readFileSync(path, "utf-8").trim().split("\n")).toHaveLength(1);
  });

  it("never throws when the destination is unwritable", () => {
    // A path whose parent directory does not exist — appendFileSync will fail.
    const unwritable = join(scratch(), "missing-dir", "nested", "log.jsonl");
    expect(() =>
      mod.logCliInvocation({ binary: "claude", args: ["-p"] }, { NDX_CLI_LOG_PATH: unwritable }),
    ).not.toThrow();
  });
});

describe("cli-log twin parity: llm-client === core", () => {
  const RECORDS = [
    { binary: "claude", args: ["-p", "hello world"], via: "spawnCli", platform: "win32" },
    { binary: "C:\\Program Files\\claude\\claude.cmd", args: ["--api-key", "sk-ant-zzz"], platform: "win32" },
    { binary: "/usr/local/bin/codex", args: ["exec", "-", ""], cwd: "/proj", platform: "linux" },
    { binary: "claude", args: ["--api-key=sk-ant-q", "ghp_0123456789abcdefghij"], platform: "darwin" },
    { binary: "rex", args: [], platform: "linux", commandLine: 'rex ""' },
  ];

  it("emits byte-identical log lines for the same record", () => {
    const ts = "2026-08-17T00:00:00.000Z";
    for (const record of RECORDS) {
      expect(core.formatCliLogLine(record, ts)).toBe(llm.formatCliLogLine(record, ts));
    }
  });

  it("agrees on redaction, vendor labels, enablement, and the size cap", () => {
    for (const record of RECORDS) {
      expect(core.redactArgs(record.args)).toEqual(llm.redactArgs(record.args));
      expect(core.vendorFromBinary(record.binary)).toBe(llm.vendorFromBinary(record.binary));
    }
    for (const v of [undefined, "0", "false", "no", "1", "yes"]) {
      expect(core.isCliLogEnabled({ NDX_CLI_LOG: v })).toBe(llm.isCliLogEnabled({ NDX_CLI_LOG: v }));
    }
    expect(core.CLI_LOG_MAX_BYTES).toBe(llm.CLI_LOG_MAX_BYTES);
    expect(core.CLI_LOG_FILENAME).toBe(llm.CLI_LOG_FILENAME);
  });
});
