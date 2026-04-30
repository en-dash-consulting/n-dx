/**
 * Test command resolution with config fallback and interactive prompt.
 *
 * Resolution chain:
 * 1. .hench/config.json fullTestCommand
 * 2. .n-dx.json hench.fullTestCommand
 * 3. Auto-detect from package.json (test, test:all scripts)
 * 4. Interactive prompt (when none found or execution denied)
 *
 * User-supplied commands are persisted to .hench/config.json for future runs.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TestCommandResolverOptions {
  /** Project root directory. */
  projectDir: string;
  /** Hench config directory (.hench). */
  henchDir: string;
  /** Current hench config with potential fullTestCommand field. */
  config?: { fullTestCommand?: string };
}

export interface TestCommandResolveResult {
  /** The resolved test command. */
  command: string;
  /** Where the command came from. */
  source: "config" | "project-config" | "auto-detect" | "user-prompt";
  /** Whether the command was newly persisted to config. */
  persisted?: boolean;
}

// ---------------------------------------------------------------------------
// Config loading
// ---------------------------------------------------------------------------

/**
 * Load .n-dx.json project config and extract hench.fullTestCommand if present.
 */
async function loadProjectConfig(projectDir: string): Promise<string | undefined> {
  try {
    const configPath = join(projectDir, ".n-dx.json");
    const content = await readFile(configPath, "utf-8");
    const config = JSON.parse(content) as Record<string, unknown>;
    const hench = config.hench as Record<string, unknown> | undefined;
    return typeof hench?.fullTestCommand === "string" ? hench.fullTestCommand : undefined;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Auto-detection from package.json
// ---------------------------------------------------------------------------

/**
 * Auto-detect test command from package.json scripts.
 * Checks for "test" or "test:all" scripts (in that order).
 */
async function autoDetectTestCommand(projectDir: string): Promise<string | undefined> {
  try {
    const packagePath = join(projectDir, "package.json");
    const content = await readFile(packagePath, "utf-8");
    const pkg = JSON.parse(content) as Record<string, unknown>;
    const scripts = pkg.scripts as Record<string, string> | undefined;

    if (!scripts) return undefined;

    // Prefer "test:all" over "test" for comprehensive suite
    if (scripts["test:all"]) {
      return `npm run test:all`;
    }

    if (scripts["test"]) {
      return `npm run test`;
    }

    return undefined;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Interactive prompt with SIGINT handling
// ---------------------------------------------------------------------------

/**
 * Prompt user for test command with explanation of full-suite requirement.
 * Shows opt-out flag and clear messaging.
 */
async function promptForTestCommand(): Promise<string | undefined> {
  const { createInterface } = await import("node:readline");

  return new Promise<string | undefined>((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    // Suspend SIGINT listeners during prompt
    const savedListeners = process.listeners("SIGINT") as Array<(...args: unknown[]) => void>;
    for (const listener of savedListeners) {
      process.removeListener("SIGINT", listener);
    }

    let settled = false;
    const finish = (value: string | undefined): void => {
      if (settled) return;
      settled = true;

      process.removeListener("SIGINT", onInterrupt);
      rl.removeListener("SIGINT", onInterrupt);
      rl.close();

      // Restore outer SIGINT listeners
      for (const listener of savedListeners) {
        process.on("SIGINT", listener);
      }

      resolve(value);
    };

    const onInterrupt = (): void => {
      console.log("\nTest command resolution cancelled.");
      finish(undefined);
    };

    process.on("SIGINT", onInterrupt);
    rl.on("SIGINT", onInterrupt);

    const prompt = `
┌─────────────────────────────────────────────────────────────────────────┐
│ Test Suite Command Required                                             │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│ The mandatory pre-commit gate needs to run your entire test suite       │
│ before allowing commits. No test command could be auto-detected.        │
│                                                                          │
│ Provide your test command (e.g. "pnpm test" or "npm run test:all"):     │
│                                                                          │
│ Alternatives:                                                           │
│   • Press Ctrl+C to cancel                                              │
│   • Use --skip-test-gate to opt out (not recommended)                   │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘

Test command: `;

    rl.question(prompt, (input: string) => {
      const trimmed = input.trim();
      finish(trimmed || undefined);
    });
  });
}

// ---------------------------------------------------------------------------
// Config persistence
// ---------------------------------------------------------------------------

/**
 * Save test command to .hench/config.json.
 * Loads existing config, updates fullTestCommand, and writes back.
 */
async function persistTestCommand(
  henchDir: string,
  command: string,
): Promise<void> {
  try {
    const { readFile: readFileSync, writeFile: writeFileSync } = await import("node:fs/promises");
    const configPath = join(henchDir, "config.json");

    // Load existing config
    let config: Record<string, unknown>;
    try {
      const content = await readFileSync(configPath, "utf-8");
      config = JSON.parse(content);
    } catch {
      config = {};
    }

    // Update test command
    config.fullTestCommand = command;

    // Write back with canonical formatting
    const { toCanonicalJSON } = await import("../store/json.js");
    await writeFileSync(configPath, toCanonicalJSON(config), "utf-8");
  } catch (err) {
    // Best-effort — don't fail the run if we can't persist
    console.warn(`Warning: could not persist test command to config: ${(err as Error).message}`);
  }
}

// ---------------------------------------------------------------------------
// Main resolver
// ---------------------------------------------------------------------------

/**
 * Resolve the test command with config fallback and interactive prompt.
 *
 * Returns the resolved command and its source. In autonomous mode (--auto, --loop)
 * without a resolvable command, throws with clear guidance.
 */
export async function resolveTestCommand(
  options: TestCommandResolverOptions,
  autonomous?: boolean,
): Promise<TestCommandResolveResult> {
  // 1. Check .hench/config.json
  if (options.config?.fullTestCommand) {
    return {
      command: options.config.fullTestCommand,
      source: "config",
    };
  }

  // 2. Check .n-dx.json
  const projectConfigCommand = await loadProjectConfig(options.projectDir);
  if (projectConfigCommand) {
    return {
      command: projectConfigCommand,
      source: "project-config",
    };
  }

  // 3. Auto-detect from package.json
  const autoDetected = await autoDetectTestCommand(options.projectDir);
  if (autoDetected) {
    return {
      command: autoDetected,
      source: "auto-detect",
    };
  }

  // 4. No command found — prompt or error
  if (autonomous) {
    throw new Error(
      `No test command configured and none could be auto-detected.\n` +
      `Provide a command in one of these ways:\n` +
      `  1. Edit .hench/config.json and add: { "fullTestCommand": "..." }\n` +
      `  2. Edit .n-dx.json and add: { "hench": { "fullTestCommand": "..." } }\n` +
      `  3. Add "test" or "test:all" script to package.json\n` +
      `  4. Opt out with --skip-test-gate (not recommended)\n\n` +
      `Run in interactive mode (without --auto or --loop) to be prompted.`,
    );
  }

  // Interactive prompt (TTY only)
  if (!process.stdin.isTTY) {
    throw new Error(
      `No test command configured and stdin is not a TTY.\n` +
      `Provide a command in one of these ways (see above) or run in interactive mode.`,
    );
  }

  const userCommand = await promptForTestCommand();
  if (!userCommand) {
    throw new Error(
      `Test command resolution required but was cancelled by user.\n` +
      `Provide a command or use --skip-test-gate to opt out.`,
    );
  }

  // Persist to config for future runs
  await persistTestCommand(options.henchDir, userCommand);

  return {
    command: userCommand,
    source: "user-prompt",
    persisted: true,
  };
}
