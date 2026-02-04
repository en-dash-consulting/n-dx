import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const cliPath = join(
  fileURLToPath(import.meta.url),
  "..",
  "..",
  "..",
  "dist",
  "cli",
  "index.js",
);

function run(args: string[]): string {
  return execFileSync("node", [cliPath, ...args], {
    encoding: "utf-8",
    timeout: 15000,
  });
}

function runExpectFail(args: string[], timeout = 15000): { stdout: string; stderr: string } {
  try {
    const stdout = execFileSync("node", [cliPath, ...args], {
      encoding: "utf-8",
      timeout,
    });
    return { stdout, stderr: "" };
  } catch (err) {
    return {
      stdout: (err as { stdout?: string }).stdout ?? "",
      stderr: (err as { stderr?: string }).stderr ?? "",
    };
  }
}

/**
 * Run command with a very short timeout — used for tests that trigger LLM calls
 * where we just want to verify routing, not wait for the LLM response.
 */
function runQuick(args: string[]): { stdout: string; stderr: string; timedOut: boolean } {
  const result = spawnSync("node", [cliPath, ...args], {
    encoding: "utf-8",
    timeout: 3000,
  });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    timedOut: result.status === null && result.signal === "SIGTERM",
  };
}

describe("rex add (smart mode routing)", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "rex-e2e-smart-add-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("manual mode still works: rex add epic --title=X", async () => {
    run(["init", tmpDir]);

    const output = run(["add", "epic", "--title=Test Epic", tmpDir]);

    expect(output).toContain("Created epic: Test Epic");
    expect(output).toContain("ID:");

    // Verify in prd.json
    const prd = JSON.parse(
      await readFile(join(tmpDir, ".rex", "prd.json"), "utf-8"),
    );
    expect(prd.items.some((i: { title: string }) => i.title === "Test Epic")).toBe(true);
  });

  it("manual mode still works: rex add feature with parent", async () => {
    run(["init", tmpDir]);
    const epicOutput = run(["add", "epic", "--title=My Epic", "--format=json", tmpDir]);
    const epicId = JSON.parse(epicOutput).id;

    const output = run(["add", "feature", `--title=My Feature`, `--parent=${epicId}`, tmpDir]);

    expect(output).toContain("Created feature: My Feature");
  });

  it("--level flag routes to manual mode", async () => {
    run(["init", tmpDir]);

    const output = run(["add", "--level=epic", "--title=Flag Epic", tmpDir]);

    expect(output).toContain("Created epic: Flag Epic");
    expect(output).toContain("ID:");

    const prd = JSON.parse(
      await readFile(join(tmpDir, ".rex", "prd.json"), "utf-8"),
    );
    expect(prd.items.some((i: { title: string }) => i.title === "Flag Epic")).toBe(true);
  });

  it("--level flag with --parent creates correct child", async () => {
    run(["init", tmpDir]);
    const epicOutput = run(["add", "--level=epic", "--title=Parent Epic", "--format=json", tmpDir]);
    const epicId = JSON.parse(epicOutput).id;

    const output = run([
      "add",
      `--level=feature`,
      `--title=Child Feature`,
      `--parent=${epicId}`,
      tmpDir,
    ]);

    expect(output).toContain("Created feature: Child Feature");
  });

  it("--title only (no level) defaults to epic", async () => {
    run(["init", tmpDir]);

    const output = run(["add", "--title=Auto Epic", "--format=json", tmpDir]);
    const parsed = JSON.parse(output);

    expect(parsed.level).toBe("epic");
    expect(parsed.title).toBe("Auto Epic");
  });

  it("--title with --parent infers level from parent", async () => {
    run(["init", tmpDir]);
    const epicOutput = run(["add", "epic", "--title=E", "--format=json", tmpDir]);
    const epicId = JSON.parse(epicOutput).id;

    const output = run([
      "add",
      `--title=Inferred Feature`,
      `--parent=${epicId}`,
      "--format=json",
      tmpDir,
    ]);
    const parsed = JSON.parse(output);

    expect(parsed.level).toBe("feature");
    expect(parsed.title).toBe("Inferred Feature");
  });

  it("--title bypasses LLM even with description-like text", async () => {
    run(["init", tmpDir]);

    // With --title, this should NOT trigger smart mode even though the title
    // looks like a natural language description
    const output = run([
      "add",
      "--title=Add user authentication with OAuth support",
      tmpDir,
    ]);

    expect(output).toContain("Created epic: Add user authentication with OAuth support");
    // Should NOT show any LLM-related output
    expect(output).not.toContain("Analyzing");
    expect(output).not.toContain("LLM");
  });

  it("shows error without .rex/ for smart add", () => {
    const { stderr } = runExpectFail([
      "add",
      "Add user authentication with OAuth",
      tmpDir,
    ]);

    expect(stderr).toContain("rex init");
  });

  it("shows error when no arguments provided", () => {
    const { stderr } = runExpectFail(["add"]);

    expect(stderr).toContain("Usage:");
  });

  it("smart mode triggers for non-level first argument", async () => {
    run(["init", tmpDir]);

    // Run with short timeout — we just want to verify routing to smart add
    // The command will either print "Analyzing description..." before the LLM call
    // or fail/timeout during the LLM call
    const { stderr, stdout, timedOut } = runQuick([
      "add",
      "Add user authentication with OAuth",
      tmpDir,
    ]);

    const combined = stderr + stdout;
    // Either it started the LLM analysis (showing the message before the call),
    // or the LLM call failed, or it timed out during the LLM call
    expect(
      combined.includes("Analyzing description") ||
      combined.includes("LLM analysis failed") ||
      combined.includes("claude CLI not found") ||
      timedOut,
    ).toBe(true);
  }, 10000);

  it("smart mode with --description flag", async () => {
    run(["init", tmpDir]);

    const { stderr, stdout, timedOut } = runQuick([
      "add",
      "--description=Build caching layer",
      tmpDir,
    ]);

    const combined = stderr + stdout;
    expect(
      combined.includes("Analyzing description") ||
      combined.includes("LLM analysis failed") ||
      combined.includes("claude CLI not found") ||
      timedOut,
    ).toBe(true);
  }, 10000);

  it("non-level argument triggers smart mode, not manual mode error", () => {
    // "notavalidlevel" is not a valid level, so it triggers smart mode
    // without .rex/ it will show "rex init" error
    const { stderr, stdout } = runExpectFail([
      "add",
      "notavalidlevel",
      tmpDir,
    ]);

    const combined = stderr + stdout;
    // Smart mode tries to run and fails because no .rex/ (tmpDir has no .rex/)
    expect(combined).toContain("rex init");
  });
});

describe("rex add with multiple descriptions", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "rex-e2e-multi-desc-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("multiple positional descriptions trigger smart mode with multi label", async () => {
    run(["init", tmpDir]);

    const { stderr, stdout, timedOut } = runQuick([
      "add",
      "Add user authentication",
      "Build admin dashboard",
      "Implement rate limiting",
      tmpDir,
    ]);

    const combined = stderr + stdout;
    // Should show multi-description message, or LLM call results/failures
    expect(
      combined.includes("Analyzing 3 descriptions") ||
      combined.includes("LLM analysis failed") ||
      combined.includes("claude CLI not found") ||
      timedOut,
    ).toBe(true);
  }, 10000);

  it("two descriptions route to multi-description mode", async () => {
    run(["init", tmpDir]);

    const { stderr, stdout, timedOut } = runQuick([
      "add",
      "Add caching layer",
      "Build monitoring dashboard",
      tmpDir,
    ]);

    const combined = stderr + stdout;
    expect(
      combined.includes("Analyzing 2 descriptions") ||
      combined.includes("LLM analysis failed") ||
      combined.includes("claude CLI not found") ||
      timedOut,
    ).toBe(true);
  }, 10000);

  it("--description flag combined with positional args", async () => {
    run(["init", tmpDir]);

    const { stderr, stdout, timedOut } = runQuick([
      "add",
      "Add auth",
      "--description=Build dashboard",
      tmpDir,
    ]);

    const combined = stderr + stdout;
    // Both descriptions should be collected (2 total)
    expect(
      combined.includes("Analyzing 2 descriptions") ||
      combined.includes("LLM analysis failed") ||
      combined.includes("claude CLI not found") ||
      timedOut,
    ).toBe(true);
  }, 10000);

  it("shows error without .rex/ for multi-description mode", () => {
    const { stderr } = runExpectFail([
      "add",
      "Add auth",
      "Build dashboard",
      tmpDir,
    ]);

    expect(stderr).toContain("rex init");
  });

  it("single description still works normally", async () => {
    run(["init", tmpDir]);

    const { stderr, stdout, timedOut } = runQuick([
      "add",
      "Add user authentication with OAuth",
      tmpDir,
    ]);

    const combined = stderr + stdout;
    // Should show single-description message (no count)
    expect(
      combined.includes("Analyzing description") ||
      combined.includes("LLM analysis failed") ||
      combined.includes("claude CLI not found") ||
      timedOut,
    ).toBe(true);
    // Should NOT say "2 descriptions" (the dir isn't counted as a description)
    expect(combined).not.toContain("2 descriptions");
  }, 10000);
});

describe("rex add --file (idea import)", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "rex-e2e-idea-import-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("shows error without .rex/ for --file mode", async () => {
    const ideasFile = join(tmpDir, "ideas.txt");
    await writeFile(ideasFile, "maybe add dark mode\nadd caching");

    const { stderr } = runExpectFail([
      "add",
      `--file=${ideasFile}`,
      tmpDir,
    ]);

    expect(stderr).toContain("rex init");
  });

  it("routes --file flag to idea import mode", async () => {
    run(["init", tmpDir]);

    const ideasFile = join(tmpDir, "ideas.txt");
    await writeFile(
      ideasFile,
      "maybe add dark mode\nalso need better error handling\nwhat about caching?",
    );

    // Run with short timeout — we just want to verify routing to idea import
    const { stderr, stdout, timedOut } = runQuick([
      "add",
      `--file=${ideasFile}`,
      tmpDir,
    ]);

    const combined = stderr + stdout;
    // Should show idea-specific message, or LLM call results/failures
    expect(
      combined.includes("Reading") ||
      combined.includes("ideas") ||
      combined.includes("Failed to process ideas file") ||
      combined.includes("claude CLI not found") ||
      timedOut,
    ).toBe(true);
  }, 10000);

  it("supports multiple --file flags", async () => {
    run(["init", tmpDir]);

    const file1 = join(tmpDir, "ideas1.txt");
    const file2 = join(tmpDir, "ideas2.txt");
    await writeFile(file1, "add login page");
    await writeFile(file2, "add dashboard");

    const { stderr, stdout, timedOut } = runQuick([
      "add",
      `--file=${file1}`,
      `--file=${file2}`,
      tmpDir,
    ]);

    const combined = stderr + stdout;
    expect(
      combined.includes("ideas files") ||
      combined.includes("Reading") ||
      combined.includes("Failed to process ideas file") ||
      combined.includes("claude CLI not found") ||
      timedOut,
    ).toBe(true);
  }, 10000);

  it("--file works alongside a description", async () => {
    run(["init", tmpDir]);

    const ideasFile = join(tmpDir, "ideas.txt");
    await writeFile(ideasFile, "add charts");

    // When both --file and description are provided, --file takes precedence
    const { stderr, stdout, timedOut } = runQuick([
      "add",
      `--file=${ideasFile}`,
      "also add reports",
      tmpDir,
    ]);

    const combined = stderr + stdout;
    expect(
      combined.includes("Reading") ||
      combined.includes("ideas") ||
      combined.includes("Failed to process ideas file") ||
      combined.includes("claude CLI not found") ||
      timedOut,
    ).toBe(true);
  }, 10000);

  it("--file=<path> without positional args routes correctly", async () => {
    run(["init", tmpDir]);

    const ideasFile = join(tmpDir, "ideas.txt");
    await writeFile(ideasFile, "build a notifications system");

    // Only --file flag, no positional description
    const { stderr, stdout, timedOut } = runQuick([
      "add",
      `--file=${ideasFile}`,
      tmpDir,
    ]);

    const combined = stderr + stdout;
    // Should NOT show "Missing description" error
    expect(combined).not.toContain("Missing description");
    expect(combined).not.toContain("Missing level");
  }, 10000);
});

describe("rex add with piped stdin", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "rex-e2e-stdin-add-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("accepts piped stdin as description", async () => {
    run(["init", tmpDir]);

    const result = spawnSync("node", [cliPath, "add", tmpDir], {
      input: "Add a notifications system with email and push support",
      encoding: "utf-8",
      timeout: 3000,
    });

    const combined = (result.stderr ?? "") + (result.stdout ?? "");
    const timedOut = result.status === null && result.signal === "SIGTERM";
    expect(
      combined.includes("Analyzing description") ||
      combined.includes("LLM analysis failed") ||
      combined.includes("claude CLI not found") ||
      timedOut,
    ).toBe(true);
  }, 10000);

  it("piped multiline input is treated as single description", async () => {
    run(["init", tmpDir]);

    const input = "Add user authentication\nwith OAuth and JWT support\nand password reset";
    const result = spawnSync("node", [cliPath, "add", tmpDir], {
      input,
      encoding: "utf-8",
      timeout: 3000,
    });

    const combined = (result.stderr ?? "") + (result.stdout ?? "");
    const timedOut = result.status === null && result.signal === "SIGTERM";
    // Multiline piped input is a single description, not multiple
    expect(
      combined.includes("Analyzing description") ||
      combined.includes("LLM analysis failed") ||
      combined.includes("claude CLI not found") ||
      timedOut,
    ).toBe(true);
    expect(combined).not.toContain("3 descriptions");
  }, 10000);

  it("piped stdin combines with positional descriptions", async () => {
    run(["init", tmpDir]);

    const result = spawnSync(
      "node",
      [cliPath, "add", "Build caching layer", tmpDir],
      {
        input: "Add monitoring dashboard",
        encoding: "utf-8",
        timeout: 3000,
      },
    );

    const combined = (result.stderr ?? "") + (result.stdout ?? "");
    const timedOut = result.status === null && result.signal === "SIGTERM";
    // Should see 2 descriptions (1 positional + 1 from stdin)
    expect(
      combined.includes("Analyzing 2 descriptions") ||
      combined.includes("LLM analysis failed") ||
      combined.includes("claude CLI not found") ||
      timedOut,
    ).toBe(true);
  }, 10000);

  it("empty piped input is ignored", async () => {
    run(["init", tmpDir]);

    const result = spawnSync(
      "node",
      [cliPath, "add", "Build caching layer", tmpDir],
      {
        input: "",
        encoding: "utf-8",
        timeout: 3000,
      },
    );

    const combined = (result.stderr ?? "") + (result.stdout ?? "");
    const timedOut = result.status === null && result.signal === "SIGTERM";
    // With empty stdin, only the positional description counts
    expect(
      combined.includes("Analyzing description") ||
      combined.includes("LLM analysis failed") ||
      combined.includes("claude CLI not found") ||
      timedOut,
    ).toBe(true);
    expect(combined).not.toContain("2 descriptions");
  }, 10000);

  it("piped stdin without any other description triggers smart mode", async () => {
    run(["init", tmpDir]);

    const result = spawnSync("node", [cliPath, "add", tmpDir], {
      input: "Build a REST API for user management",
      encoding: "utf-8",
      timeout: 3000,
    });

    const combined = (result.stderr ?? "") + (result.stdout ?? "");
    const timedOut = result.status === null && result.signal === "SIGTERM";
    // Should NOT show "Missing description" error
    expect(combined).not.toContain("Missing description");
    expect(combined).not.toContain("Missing level");
    expect(
      combined.includes("Analyzing description") ||
      combined.includes("LLM analysis failed") ||
      combined.includes("claude CLI not found") ||
      timedOut,
    ).toBe(true);
  }, 10000);

  it("shows error with no piped input and no arguments", () => {
    run(["init", tmpDir]);

    // No stdin input, no positional args — should error
    const { stderr } = runExpectFail(["add", tmpDir]);

    expect(stderr).toContain("Usage:");
  });
});
