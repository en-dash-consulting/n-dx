/**
 * Discover the commands that run or build this project.
 *
 * The dashboard offers these as buttons, so the list is also the allowlist:
 * `routes-run-commands.ts` executes an entry by its id and never takes a
 * binary from the caller. That is what keeps a control for "run the dev
 * server" from being a way to run anything at all over HTTP.
 *
 * Detection is deliberately shallow — a manifest read and a lookup of
 * well-known script names. It is a convenience that offers the obvious
 * command, not a build-system integration, and a project whose entry point
 * is not conventional simply gets no offer rather than a wrong one.
 *
 * @module web/server/run-command-detect
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** A command the dashboard is willing to run, and how to spawn it. */
export interface DetectedCommand {
  /** Stable identifier; the only thing a caller may name. */
  id: string;
  /** How the command reads to a human, e.g. `pnpm run dev`. */
  label: string;
  /** Whether this serves (stays up) or builds (finishes). */
  kind: "run" | "build";
  /** Executable, spawned without a shell. */
  bin: string;
  /** Fixed arguments. Anything the user adds is appended as separate argv. */
  args: string[];
  /** Where the command was found, shown so an offer can be judged. */
  source: string;
}

/**
 * npm script names worth offering, and what each one is.
 *
 * Ordered: the first match of each kind becomes the default offer, so `dev`
 * beats `start` for a project that has both.
 */
const SCRIPT_KINDS: ReadonlyArray<readonly [string, "run" | "build"]> = [
  ["dev", "run"],
  ["start", "run"],
  ["serve", "run"],
  ["preview", "run"],
  ["build", "build"],
  ["compile", "build"],
  ["bundle", "build"],
];

/** Lockfile → package manager. First match wins. */
const LOCKFILES: ReadonlyArray<readonly [string, string]> = [
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["bun.lockb", "bun"],
  ["package-lock.json", "npm"],
];

/**
 * Which package manager this project uses.
 *
 * The lockfile is the strongest signal — it is what the project actually
 * installs with. `packageManager` is consulted next, and npm is the fallback
 * because it ships with Node.
 */
export function detectPackageManager(projectDir: string): string {
  for (const [file, pm] of LOCKFILES) {
    if (existsSync(join(projectDir, file))) return pm;
  }
  const pkg = readJson(join(projectDir, "package.json"));
  const declared = typeof pkg?.packageManager === "string" ? pkg.packageManager : null;
  if (declared) {
    const name = declared.split("@")[0].trim();
    if (name) return name;
  }
  return "npm";
}

function readJson(path: string): Record<string, unknown> | null {
  try {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    // A manifest we cannot parse offers nothing; it is not an error worth
    // failing the whole detection for.
    return null;
  }
}

function fromPackageJson(projectDir: string): DetectedCommand[] {
  const pkg = readJson(join(projectDir, "package.json"));
  const scripts = pkg?.scripts;
  if (!scripts || typeof scripts !== "object") return [];

  const available = scripts as Record<string, unknown>;
  const pm = detectPackageManager(projectDir);
  const out: DetectedCommand[] = [];

  for (const [name, kind] of SCRIPT_KINDS) {
    if (typeof available[name] !== "string") continue;
    out.push({
      id: `${pm}:${name}`,
      label: `${pm} run ${name}`,
      kind,
      bin: pm,
      args: ["run", name],
      source: `package.json scripts.${name}`,
    });
  }
  return out;
}

/** Conventional Python entry points, in the order they are preferred. */
const PYTHON_ENTRIES = ["manage.py", "main.py", "app.py", "run.py"];

function fromPython(projectDir: string): DetectedCommand[] {
  const isPythonProject =
    existsSync(join(projectDir, "pyproject.toml")) ||
    existsSync(join(projectDir, "requirements.txt")) ||
    existsSync(join(projectDir, "setup.py"));
  if (!isPythonProject) return [];

  // `python3` is not on PATH on Windows, where the launcher is `python`.
  const bin = process.platform === "win32" ? "python" : "python3";

  for (const entry of PYTHON_ENTRIES) {
    if (!existsSync(join(projectDir, entry))) continue;
    return [{
      id: `python:${entry}`,
      label: `${bin} ${entry}`,
      kind: "run",
      bin,
      args: [entry],
      source: entry,
    }];
  }
  return [];
}

function fromCargo(projectDir: string): DetectedCommand[] {
  if (!existsSync(join(projectDir, "Cargo.toml"))) return [];
  return [
    { id: "cargo:run", label: "cargo run", kind: "run", bin: "cargo", args: ["run"], source: "Cargo.toml" },
    { id: "cargo:build", label: "cargo build", kind: "build", bin: "cargo", args: ["build"], source: "Cargo.toml" },
  ];
}

function fromGo(projectDir: string): DetectedCommand[] {
  if (!existsSync(join(projectDir, "go.mod"))) return [];
  return [
    { id: "go:run", label: "go run .", kind: "run", bin: "go", args: ["run", "."], source: "go.mod" },
    { id: "go:build", label: "go build ./...", kind: "build", bin: "go", args: ["build", "./..."], source: "go.mod" },
  ];
}

/** Make targets worth offering, and what each one is. */
const MAKE_TARGETS: ReadonlyArray<readonly [string, "run" | "build"]> = [
  ["run", "run"],
  ["dev", "run"],
  ["serve", "run"],
  ["build", "build"],
];

function fromMakefile(projectDir: string): DetectedCommand[] {
  const path = join(projectDir, "Makefile");
  if (!existsSync(path)) return [];
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return [];
  }

  const out: DetectedCommand[] = [];
  for (const [target, kind] of MAKE_TARGETS) {
    // A target is a line starting at column 0 with `name:` — not a variable
    // assignment and not an indented recipe line.
    const declared = new RegExp(`^${target}\\s*:(?!=)`, "m").test(text);
    if (!declared) continue;
    out.push({
      id: `make:${target}`,
      label: `make ${target}`,
      kind,
      bin: "make",
      args: [target],
      source: `Makefile ${target}:`,
    });
  }
  return out;
}

/**
 * Every run and build command detected for this project.
 *
 * Node comes first because a repo that has both a `package.json` and, say, a
 * `Makefile` is nearly always driven by the former.
 */
export function detectCommands(projectDir: string): DetectedCommand[] {
  const found = [
    ...fromPackageJson(projectDir),
    ...fromPython(projectDir),
    ...fromCargo(projectDir),
    ...fromGo(projectDir),
    ...fromMakefile(projectDir),
  ];

  // Ids are the execution key, so a duplicate would make the target ambiguous.
  const seen = new Set<string>();
  return found.filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)));
}

/**
 * Extra arguments a caller may append to a detected command.
 *
 * Commands are spawned without a shell, so metacharacters are never
 * interpreted — an argument is only ever one literal argv entry. This check
 * exists so an argument cannot masquerade as something else in the UI or the
 * logs (a newline, a NUL, a control character), not to prevent shell
 * injection, which the absence of a shell already prevents.
 */
export function isSafeExtraArg(arg: string): boolean {
  return arg.length > 0 && arg.length <= 200 && !/[\0\r\n]/.test(arg);
}

/**
 * The first localhost URL a process advertises in its output.
 *
 * Dev servers pick a port at runtime and shift it when one is busy, so the
 * port is read from what the process actually said rather than assumed.
 * A wildcard bind is reported as localhost, which is what a browser on this
 * machine can actually open.
 */
export function findLocalUrl(output: string): string | null {
  const match = output.match(
    /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::\]|\[::1\]):(\d{2,5})(\/[^\s"'`]*)?/i,
  );
  if (!match) return null;
  const port = Number(match[1]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  const path = match[2] ?? "";
  const scheme = match[0].toLowerCase().startsWith("https") ? "https" : "http";
  return `${scheme}://localhost:${port}${path}`;
}
