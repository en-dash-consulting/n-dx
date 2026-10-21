/**
 * Unit tests for packages/core/win-spawn.js.
 *
 * Covers:
 *  - quoteWindowsToken / buildWindowsCliCommandLine: same edge-case table as the
 *    parity test (smoke-tests the twin is well-formed).
 *  - execFileSyncCli: runs a real process synchronously; verifies it works on the
 *    current platform and that the Windows path routes through cmd.exe.
 *  - spawnCli: spawns a real child process; verifies it works on the current
 *    platform and that stdin piping works.
 */

import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import {
  quoteWindowsToken,
  buildWindowsCliCommandLine,
  execFileSyncCli,
  spawnCli,
  assertNoWindowsEnvExpansion,
} from "../../packages/core/win-spawn.js";

// ---------------------------------------------------------------------------
// quoteWindowsToken
// ---------------------------------------------------------------------------

describe("quoteWindowsToken", () => {
  it("wraps a plain token in double quotes", () => {
    expect(quoteWindowsToken("hello")).toBe('"hello"');
  });

  it("wraps an empty token in double quotes", () => {
    expect(quoteWindowsToken("")).toBe('""');
  });

  it("doubles embedded double quotes", () => {
    expect(quoteWindowsToken('say "hi"')).toBe('"say ""hi"""');
  });

  it("doubles backslashes before a closing quote (trailing backslash)", () => {
    expect(quoteWindowsToken("C:\\dir with space\\")).toBe('"C:\\dir with space\\\\"');
  });

  it("doubles backslashes before an embedded quote", () => {
    // token: a\"b (a, \, ", b)  →  "a\\""b" (outer quotes + doubled-\ + doubled-")
    expect(quoteWindowsToken('a\\"b')).toBe('"a\\\\""b"');
  });

  it("preserves non-adjacent backslashes unchanged", () => {
    expect(quoteWindowsToken("C:\\tools\\claude.cmd")).toBe('"C:\\tools\\claude.cmd"');
  });

  it("quotes cmd metacharacter tokens unconditionally", () => {
    const token = "C:\\Users\\Tom&Jerry\\out.txt";
    const result = quoteWindowsToken(token);
    expect(result.startsWith('"')).toBe(true);
    expect(result.endsWith('"')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildWindowsCliCommandLine
// ---------------------------------------------------------------------------

describe("buildWindowsCliCommandLine", () => {
  it("quotes args and leaves a bare binary name unquoted", () => {
    expect(buildWindowsCliCommandLine("node", ["--version"])).toBe(
      'node "--version"',
    );
  });

  // A quoted command name defeats cmd.exe PATHEXT resolution — see the
  // rationale on buildWindowsCliCommandLine in packages/llm-client/src/exec.ts.
  it("leaves bare names unquoted so cmd.exe PATHEXT resolution still applies", () => {
    expect(buildWindowsCliCommandLine("pnpm", ["build"])).toBe('pnpm "build"');
  });

  it("handles a spaced binary path", () => {
    const line = buildWindowsCliCommandLine("C:\\Program Files\\node\\node.exe", ["arg"]);
    expect(line).toBe('"C:\\Program Files\\node\\node.exe" "arg"');
  });

  it("handles zero args", () => {
    expect(buildWindowsCliCommandLine("claude", [])).toBe("claude");
  });
});

// ---------------------------------------------------------------------------
// execFileSyncCli — functional smoke test (runs a real process)
// ---------------------------------------------------------------------------

describe("execFileSyncCli", () => {
  it("runs node --version and returns a version string", () => {
    const out = execFileSyncCli(process.execPath, ["--version"], {
      encoding: "utf-8",
      stdio: "pipe",
    });
    expect(String(out).trim()).toMatch(/^v\d+\.\d+/);
  });

  it("throws when the binary does not exist", () => {
    expect(() =>
      execFileSyncCli("__ndx_nonexistent_binary__", ["--version"], {
        encoding: "utf-8",
        stdio: "pipe",
      }),
    ).toThrow();
  });

  it("passes stdin input to the process", () => {
    const script = `process.stdin.setEncoding('utf-8'); let d=''; process.stdin.on('data', c => d+=c); process.stdin.on('end', () => process.stdout.write(d.trim()));`;
    const out = execFileSyncCli(process.execPath, ["-e", script], {
      input: "hello from stdin",
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    expect(String(out)).toBe("hello from stdin");
  });

  if (process.platform === "win32") {
    it("on Windows: uses cmd.exe invocation (windowsVerbatimArguments)", () => {
      // If the Windows path were broken (e.g. using shell:true instead of cmd.exe),
      // a token with a backslash-quoted string would fail. We can verify the
      // basic cmd.exe path works by running a simple command.
      const out = execFileSyncCli(process.execPath, ["-e", "process.stdout.write('ok')"], {
        encoding: "utf-8",
        stdio: "pipe",
      });
      expect(String(out)).toBe("ok");
    });
  }
});

// ---------------------------------------------------------------------------
// spawnCli — functional smoke test
// ---------------------------------------------------------------------------

describe("spawnCli", () => {
  it("spawns a child process that exits 0", async () => {
    const exitCode = await new Promise((resolve, reject) => {
      const child = spawnCli(process.execPath, ["-e", "process.exit(0)"], {
        stdio: "pipe",
      });
      child.on("close", resolve);
      child.on("error", reject);
    });
    expect(exitCode).toBe(0);
  });

  it("delivers stdin to the child process", async () => {
    const script = `process.stdin.setEncoding('utf-8'); let d=''; process.stdin.on('data', c => d+=c); process.stdin.on('end', () => { process.stdout.write(d.trim()); process.exit(0); });`;
    const output = await new Promise((resolve, reject) => {
      const child = spawnCli(process.execPath, ["-e", script], {
        stdio: ["pipe", "pipe", "pipe"],
      });
      let out = "";
      child.stdout.on("data", (chunk) => { out += chunk; });
      child.stdin.on("error", () => {});
      child.stdin.write("test payload");
      child.stdin.end();
      child.on("close", () => resolve(out));
      child.on("error", reject);
    });
    expect(output).toBe("test payload");
  });

  it("returns a child with kill() method", () => {
    const child = spawnCli(process.execPath, ["-e", "setTimeout(()=>{},9999)"], {
      stdio: "pipe",
    });
    expect(typeof child.kill).toBe("function");
    child.kill("SIGTERM");
  });
});

// ---------------------------------------------------------------------------
// assertNoWindowsEnvExpansion — the refusal, exercised directly so it runs on
// every platform (execFileSyncCli / spawnCli only reach it on win32)
// ---------------------------------------------------------------------------

describe("assertNoWindowsEnvExpansion (core twin)", () => {
  it("refuses a variable the environment defines, case-insensitively", () => {
    expect(() => assertNoWindowsEnvExpansion(["model%INJECT%"], { INJECT: "x" })).toThrow(/%INJECT%/);
    expect(() => assertNoWindowsEnvExpansion(["%inject%"], { INJECT: "x" })).toThrow(/Refusing to spawn/);
  });

  it("refuses cmd.exe's own dynamic variables, which no environment lists", () => {
    for (const token of ["m%CMDCMDLINE:~-1%", "x%CD%y", "%RANDOM%", "%ERRORLEVEL%", "%=C:%", "%=ExitCode%"]) {
      expect(() => assertNoWindowsEnvExpansion([token], {}), token).toThrow(/would expand/);
    }
  });

  it("reads the name before a modifier", () => {
    expect(() => assertNoWindowsEnvExpansion(["x%OS:~0,3%y"], { OS: "Windows_NT" })).toThrow(/%OS:~0,3%/);
    expect(() => assertNoWindowsEnvExpansion(['x%OS:W=" & whoami & echo %y'], { OS: "Windows_NT" })).toThrow(
      /Refusing to spawn/,
    );
  });

  it("refuses a token holding a line break", () => {
    expect(() => assertNoWindowsEnvExpansion(["a\necho SECOND"], {})).toThrow(/line break/);
    expect(() => assertNoWindowsEnvExpansion(["a\r\necho SECOND"], {})).toThrow(/line break/);
  });

  it("leaves a lone percent sign and an unresolvable name alone", () => {
    expect(() => assertNoWindowsEnvExpansion(["C:\\Users\\100%cool\\claude.cmd"], { PATH: "" })).not.toThrow();
    expect(() => assertNoWindowsEnvExpansion(["50%undefined_var%x"], { PATH: "" })).not.toThrow();
    expect(() => assertNoWindowsEnvExpansion(["%undefined_var:~1%"], { PATH: "" })).not.toThrow();
  });
});
