import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { cmdGitCredentialHelper, getCredentialManagerGuidance } from "../../../src/cli/commands/git-credential-helper.js";
import { CLIError } from "../../../src/cli/errors.js";

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
}));

const mockedExecFileSync = vi.mocked(execFileSync);

function withTTY(inputTTY: boolean, outputTTY: boolean): void {
  Object.defineProperty(process.stdin, "isTTY", {
    configurable: true,
    value: inputTTY,
  });
  Object.defineProperty(process.stdout, "isTTY", {
    configurable: true,
    value: outputTTY,
  });
}

describe("cmdGitCredentialHelper", () => {
  beforeEach(() => {
    mockedExecFileSync.mockReset();
    withTTY(true, true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    withTTY(true, true);
  });

  it("reports authenticated state when gh auth status succeeds", () => {
    cmdGitCredentialHelper();

    expect(mockedExecFileSync).toHaveBeenCalledTimes(1);
    expect(mockedExecFileSync).toHaveBeenCalledWith("gh", ["auth", "status"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
  });

  it("hands off to gh auth login when gh is unauthenticated", () => {
    const err = Object.assign(new Error("not logged in"), { status: 1 });
    mockedExecFileSync.mockImplementationOnce(() => {
      throw err;
    });

    cmdGitCredentialHelper();

    expect(mockedExecFileSync).toHaveBeenCalledTimes(2);
    expect(mockedExecFileSync).toHaveBeenNthCalledWith(1, "gh", ["auth", "status"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    expect(mockedExecFileSync).toHaveBeenCalledWith("gh", ["auth", "login"], {
      stdio: "inherit",
    });
  });

  it("throws a CLIError when stdin or stdout is not a TTY", () => {
    withTTY(false, true);
    expect(() => cmdGitCredentialHelper()).toThrow(CLIError);
    expect(() => cmdGitCredentialHelper()).toThrow(/requires a TTY/);

    withTTY(true, false);
    expect(() => cmdGitCredentialHelper()).toThrow(CLIError);
    expect(() => cmdGitCredentialHelper()).toThrow(/requires a TTY/);

    expect(mockedExecFileSync).not.toHaveBeenCalled();
  });

  it("throws a user-friendly CLIError when gh is missing", () => {
    const err = Object.assign(new Error("spawn gh ENOENT"), { code: "ENOENT" });
    mockedExecFileSync.mockImplementation(() => {
      throw err;
    });

    try {
      cmdGitCredentialHelper();
      throw new Error("expected CLIError");
    } catch (caught) {
      expect(caught).toBeInstanceOf(CLIError);
      const cliErr = caught as CLIError;
      expect(cliErr.message).toMatch(/GitHub CLI \(`gh`\) is not available on PATH/);
      expect(cliErr.suggestion).toMatch(/retry/i);
    }
  });

  it("throws a user-friendly CLIError when login is not completed", () => {
    const statusErr = Object.assign(new Error("not logged in"), { status: 1 });
    const loginErr = Object.assign(new Error("Command failed"), { status: 1 });
    mockedExecFileSync.mockImplementationOnce(() => {
      throw statusErr;
    });
    mockedExecFileSync.mockImplementationOnce(() => {
      throw loginErr;
    });

    try {
      cmdGitCredentialHelper();
      throw new Error("expected CLIError");
    } catch (caught) {
      expect(caught).toBeInstanceOf(CLIError);
      const cliErr = caught as CLIError;
      expect(cliErr.message).toMatch(/authentication was not completed/i);
    }
  });

  it("rethrows unexpected status-check errors", () => {
    const err = new TypeError("unexpected");
    mockedExecFileSync.mockImplementation(() => {
      throw err;
    });

    expect(() => cmdGitCredentialHelper()).toThrow(err);
  });
});

describe("getCredentialManagerGuidance", () => {
  it("returns macOS-specific guidance", () => {
    expect(getCredentialManagerGuidance("darwin")).toContain("macOS Keychain");
  });

  it("returns Windows-specific guidance", () => {
    expect(getCredentialManagerGuidance("win32")).toContain("Windows Credential Manager");
  });

  it("returns generic guidance for linux/other platforms", () => {
    expect(getCredentialManagerGuidance("linux")).toContain("Git Credential Manager/credential store");
  });
});
