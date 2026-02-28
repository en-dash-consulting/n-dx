import { execFileSync } from "node:child_process";
import { CLIError } from "../errors.js";
import { info } from "../output.js";

type GitHubAuthState = "authenticated" | "unauthenticated" | "tool-unavailable";

export function getCredentialManagerGuidance(platform: NodeJS.Platform = process.platform): string {
  if (platform === "darwin") {
    return "Install GitHub CLI (`brew install gh`) or configure macOS Keychain credentials, then retry.";
  }
  if (platform === "win32") {
    return "Install GitHub CLI (`winget install --id GitHub.cli`) or configure Git Credential Manager in Windows Credential Manager, then retry.";
  }
  return "Install GitHub CLI (`gh`) or configure Git Credential Manager/credential store for your platform, then retry.";
}

function resolveGitHubAuthState(): GitHubAuthState {
  try {
    execFileSync("gh", ["auth", "status"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    return "authenticated";
  } catch (error) {
    const err = error as NodeJS.ErrnoException & { status?: number };
    if (err.code === "ENOENT") return "tool-unavailable";
    if (typeof err.status === "number" && err.status !== 0) return "unauthenticated";
    throw error;
  }
}

export function cmdGitCredentialHelper(): void {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new CLIError(
      "Interactive credential setup requires a TTY.",
      "Run `sourcevision git-credential-helper` from an interactive terminal.",
    );
  }

  const authState = resolveGitHubAuthState();
  if (authState === "authenticated") {
    info("GitHub CLI authentication is already configured (`gh auth status` succeeded).");
    return;
  }
  if (authState === "tool-unavailable") {
    throw new CLIError(
      "GitHub CLI (`gh`) is not available on PATH.",
      getCredentialManagerGuidance(),
    );
  }

  info("GitHub CLI is installed but not authenticated (`gh auth status` failed).");
  info("Launching `gh auth login`...");

  try {
    execFileSync("gh", ["auth", "login"], {
      stdio: "inherit",
    });
  } catch (error) {
    const err = error as NodeJS.ErrnoException & { status?: number };
    if (err.code === "ENOENT") {
      throw new CLIError(
        "GitHub CLI (`gh`) is not available on PATH.",
        getCredentialManagerGuidance(),
      );
    }

    if (typeof err.status === "number" && err.status !== 0) {
      throw new CLIError(
        "GitHub authentication was not completed.",
        "Retry `sourcevision git-credential-helper` and complete the login flow.",
      );
    }

    throw error;
  }
}
