/**
 * `ndx extensions` — list, add, remove, enable, disable, inspect and check
 * installed extensions (docs/architecture/extensions.md, "Management commands").
 *
 * - `add` and `remove` run npm in `<ndx home>/extensions`, which has a
 *   `package.json` of its own, so no project's `package.json` is touched.
 *   Installs pass `--ignore-scripts`: an install script is package code, and
 *   nothing an extension ships runs before the user approves it.
 * - `enable` approves (asking first, or with `--yes`) and clears `disable`;
 *   `disable` hides an extension and keeps its approval, config and state folder.
 * - `doctor` prints one line per problem, each with its fix, and exits 1 when
 *   there is any.
 *
 * Nothing here runs extension code: discovery reads `package.json` files, and
 * `doctor` only checks that the declared paths exist.
 *
 * @module n-dx/extensions-command
 */

import * as nodeFs from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { discoverExtensions, USER_EXTENSIONS_DIRNAME, EXTENSIONS_CACHE_FILE } from "./extension-discovery.js";
import { escapeControlCharacters, formatProblem, isExtensionNameSlug } from "./extension-manifest.js";
import {
  approvalFor,
  describeForApproval,
  extensionState,
  forgetApproval,
  readExtensionsFile,
  recordApproval,
  setDisabled,
  stateKey,
  updateExtensionsFile,
} from "./extension-state.js";
import { spawnCli } from "./win-spawn.js";

/** Subcommands, in the order help lists them. */
export const EXTENSIONS_SUBCOMMANDS = Object.freeze(["list", "add", "remove", "enable", "disable", "info", "doctor"]);

/** Directory under the n-dx home holding each extension's state folder. */
export const EXTENSION_STATE_DIRNAME = "ext";

/**
 * The flags each subcommand takes. Any other flag is refused rather than
 * dropped, so `add --registry=…` never installs from the default registry.
 */
const SUBCOMMAND_FLAGS = Object.freeze({
  list: ["--json", "--format=json"],
  add: [],
  remove: ["--purge"],
  enable: ["--yes", "-y"],
  disable: [],
  info: ["--json", "--format=json"],
  doctor: [],
});

/**
 * What `ndx extensions` needs from its caller. `builtinCommands` comes from
 * `cli.js`, which cannot be imported; the rest default to the real thing and
 * are injectable for tests.
 *
 * @typedef {object} ExtensionsCommandDeps
 * @property {Iterable<string>} builtinCommands  Every built-in `ndx` command and tool delegation.
 * @property {string} [ndxVersion]  The running n-dx; defaults to `@n-dx/core`'s version.
 * @property {string} [cwd]  The project for the `project` source when no directory is given.
 * @property {string} [home]  The n-dx home; defaults to discovery's resolution.
 * @property {Record<string, string | undefined>} [env]
 * @property {string | null} [globalRoot]
 * @property {(args: string[], options: {cwd: string}) => Promise<number>} [runNpm]  Runs npm; resolves to its exit code.
 * @property {(question: string) => Promise<boolean>} [confirm]  Asks yes/no; omitted means no terminal to ask on.
 * @property {(line: string) => void} [out]
 * @property {(line: string) => void} [err]
 */

/**
 * One row of `ndx extensions list --json`.
 *
 * @typedef {object} ExtensionListing
 * @property {string | null} name
 * @property {string} packageName
 * @property {string | null} version
 * @property {string} source
 * @property {import("./extension-state.js").ExtensionStateName} state
 * @property {string} reason
 * @property {string} dir
 * @property {import("./extension-manifest.js").ExtensionManifest | null} manifest  Null when invalid; the hub reads `hub`, `sidecar` and `projectLinks` from it.
 */

/**
 * Run `ndx extensions <subcommand> …`.
 *
 * @param {string[]} args  Everything after `extensions`.
 * @param {ExtensionsCommandDeps} deps
 * @returns {Promise<number>} The exit code.
 */
export async function runExtensions(args, deps) {
  const ctx = context(deps);
  const flags = new Set(args.filter((a) => a.startsWith("-")));
  const [sub = "list", ...positionals] = args.filter((a) => !a.startsWith("-"));
  const json = flags.has("--json") || flags.has("--format=json");
  const unknown = [...flags].filter((f) => !(SUBCOMMAND_FLAGS[sub] ?? []).includes(f));
  if (Object.hasOwn(SUBCOMMAND_FLAGS, sub) && unknown.length > 0) {
    ctx.err(`Error: 'ndx extensions ${sub}' does not take ${unknown.join(", ")}.`);
    if (sub === "add") {
      ctx.err(`Hint: npm settings such as the registry come from npm's own config: an npm_config_* variable, or ${join(userFolder(ctx.discover(undefined).home), ".npmrc")}.`);
    } else {
      ctx.err("Hint: Run 'ndx extensions --help' for the options each subcommand takes.");
    }
    return 1;
  }
  switch (sub) {
    case "list": return list(ctx, positionals[0], json);
    case "add": return add(ctx, positionals[0]);
    case "remove": return remove(ctx, positionals[0], flags.has("--purge"));
    case "enable": return enable(ctx, positionals[0], flags.has("--yes") || flags.has("-y"));
    case "disable": return disable(ctx, positionals[0]);
    case "info": return info(ctx, positionals[0], json);
    case "doctor": return doctor(ctx, positionals[0]);
    default:
      ctx.err(`Error: Unknown 'ndx extensions' subcommand: ${sub}`);
      ctx.err(`Hint: Use one of ${EXTENSIONS_SUBCOMMANDS.join(", ")}, or run 'ndx extensions --help'.`);
      return 1;
  }
}

// ── context ──────────────────────────────────────────────────────────────────

/**
 * @typedef {ReturnType<typeof context>} Context
 */

/** @param {ExtensionsCommandDeps} deps */
function context(deps) {
  if (!deps || !deps.builtinCommands) throw new TypeError("runExtensions: deps.builtinCommands is required");
  const cwd = deps.cwd ?? process.cwd();
  const ndxVersion = deps.ndxVersion ?? ownVersion();
  const out = deps.out ?? ((/** @type {string} */ line) => console.log(line));
  const err = deps.err ?? ((/** @type {string} */ line) => console.error(line));
  /** @param {string | undefined} dir */
  const discover = (dir) => {
    const projectDir = resolve(cwd, dir ?? ".");
    const result = discoverExtensions({
      builtinCommands: deps.builtinCommands,
      projectDir,
      home: deps.home,
      env: deps.env,
      globalRoot: deps.globalRoot,
    });
    // An unreadable extensions.json is already among discovery's errors, which
    // list and doctor report; reading it again would only throw the same thing.
    const unreadable = result.errors.some((e) => e.path === join(result.home, EXTENSIONS_CACHE_FILE));
    return { ...result, projectDir, file: unreadable ? {} : readExtensionsFile(result.home) };
  };
  return {
    cwd,
    ndxVersion,
    discover,
    runNpm: deps.runNpm ?? defaultRunNpm,
    confirm: deps.confirm ?? terminalConfirm(),
    // Lines quote package names, versions, paths and manifest strings, so no
    // control character in them reaches the terminal. JSON escapes its own.
    out: (/** @type {string} */ line) => out(escapeControlCharacters(line)),
    err: (/** @type {string} */ line) => err(escapeControlCharacters(line)),
    json: (/** @type {unknown} */ value) => out(JSON.stringify(value, null, 2)),
  };
}

/**
 * @typedef {ReturnType<Context["discover"]>} Discovery
 * @typedef {import("./extension-discovery.js").DiscoveredExtension} DiscoveredExtension
 */

/**
 * @param {Discovery} d
 * @param {DiscoveredExtension} ext
 * @param {string} ndxVersion
 */
function stateOf(d, ext, ndxVersion) {
  return extensionState(ext, { file: d.file, ndxVersion, projectDir: d.projectDir });
}

/**
 * The extension a user means by `name`: its extension name, else its package name.
 *
 * @param {Discovery} d
 * @param {string} name
 */
function find(d, name) {
  return d.extensions.find((e) => e.name === name) ?? d.extensions.find((e) => e.packageName === name);
}

/**
 * Print the not-found error, or the missing-argument one.
 *
 * @param {Context} ctx
 * @param {string} sub
 * @param {string | undefined} name
 */
function notFound(ctx, sub, name) {
  if (name === undefined) {
    ctx.err(`Error: 'ndx extensions ${sub}' needs an extension name.`);
  } else {
    ctx.err(`Error: No installed extension is named '${name}'.`);
  }
  ctx.err("Hint: Run 'ndx extensions list' to see installed extensions.");
  return 1;
}

// ── list and info ────────────────────────────────────────────────────────────

/**
 * @param {Context} ctx
 * @param {string | undefined} dir
 * @param {boolean} json
 */
function list(ctx, dir, json) {
  const d = ctx.discover(dir);
  /** @type {ExtensionListing[]} */
  const rows = d.extensions.map((ext) => ({
    name: ext.name ?? null,
    packageName: ext.packageName,
    version: ext.version ?? null,
    source: ext.source,
    ...stateOf(d, ext, ctx.ndxVersion),
    dir: ext.dir,
    manifest: ext.manifest ?? null,
  }));
  if (json) {
    ctx.json({ extensions: rows, errors: d.errors });
    return 0;
  }
  if (rows.length === 0) {
    ctx.out("No extensions installed. Add one with 'ndx extensions add <package>'.");
  } else {
    // Escaped before padding, so the columns line up with what is printed.
    const table = [["NAME", "VERSION", "SOURCE", "STATE", "REASON"], ...rows.map((r) => [r.name ?? r.packageName, r.version ?? "-", r.source, r.state, r.reason].map(escapeControlCharacters))];
    const widths = table[0].map((_, i) => Math.max(...table.map((row) => row[i].length)));
    for (const row of table) ctx.out(row.map((cell, i) => (i === row.length - 1 ? cell : cell.padEnd(widths[i]))).join("  ").trimEnd());
  }
  if (d.errors.length > 0 || rows.some((r) => ["invalid", "conflict", "incompatible"].includes(r.state))) {
    ctx.err("Problems found. Run 'ndx extensions doctor' for each one and its fix.");
  }
  return 0;
}

/**
 * @param {Context} ctx
 * @param {string | undefined} name
 * @param {boolean} json
 */
function info(ctx, name, json) {
  const d = ctx.discover(undefined);
  const ext = name === undefined ? undefined : find(d, name);
  if (!ext) return notFound(ctx, "info", name);
  const { state, reason } = stateOf(d, ext, ctx.ndxVersion);
  const approval = approvalFor(d.file, ext, d.projectDir);
  if (json) {
    ctx.json({
      name: ext.name ?? null,
      packageName: ext.packageName,
      version: ext.version ?? null,
      source: ext.source,
      dir: ext.dir,
      state,
      reason,
      approval: approval ?? null,
      manifest: ext.manifest ?? null,
      problems: ext.problems,
      shadowed: ext.shadowed,
      conflicts: ext.conflicts,
    });
    return 0;
  }
  const m = ext.manifest;
  ctx.out(`${ext.name ?? ext.packageName}${m?.displayName ? ` — ${m.displayName}` : ""}`);
  ctx.out(`  package    ${ext.packageName}@${ext.version ?? "?"}`);
  ctx.out(`  source     ${ext.source} (${ext.dir})`);
  ctx.out(`  state      ${state}${reason ? ` — ${reason}` : ""}`);
  if (approval) ctx.out(`  approved   ${approval.approvedAt} (version ${approval.version ?? "?"})`);
  if (m) {
    ctx.out(`  ndxVersion ${m.ndxVersion} (this is ${ctx.ndxVersion})`);
    for (const c of m.commands ?? []) ctx.out(`  command    ndx ${c.name} — ${c.summary} (${c.bin})`);
    if (m.sidecar) ctx.out(`  sidecar    ${m.sidecar.bin}, mounted at /x/${m.name}/`);
    if (m.hub) ctx.out(`  hub card   ${m.hub.label}`);
    for (const l of m.projectLinks ?? []) ctx.out(`  link       ${l.label} → ${l.path}`);
  }
  for (const s of ext.shadowed) ctx.out(`  also found ${s.source}: ${s.dir}${s.version ? ` (${s.version})` : ""} — not used`);
  for (const c of ext.conflicts) ctx.out(`  conflict   ${c.packageName} (${c.source}, ${c.dir}) also claims ${c.names.join(", ")}`);
  for (const p of ext.problems) ctx.out(`  problem    ${formatProblem(p)}`);
  return 0;
}

// ── add and remove ───────────────────────────────────────────────────────────

/**
 * @param {Context} ctx
 * @param {string | undefined} spec
 */
async function add(ctx, spec) {
  if (spec === undefined) {
    ctx.err("Error: 'ndx extensions add' needs a package, e.g. 'ndx extensions add @scope/ndx-name'.");
    return 1;
  }
  const folder = userFolder(ctx.discover(undefined).home);
  ensureUserFolder(folder);
  // npm runs in the user folder, so a path the user typed is made absolute
  // against where they typed it.
  const localPath = localSpecPath(spec, ctx.cwd);
  const before = listedPackages(folder);
  const code = await ctx.runNpm(["install", localPath ?? spec, "--save", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: folder });
  if (code !== 0) {
    ctx.err(`Error: npm install ${localPath ?? spec} failed (exit ${code}); nothing was added.`);
    return 1;
  }
  const after = listedPackages(folder);
  const added = [...after.keys()].filter((p) => !before.has(p));
  const changed = [...after.keys()].filter((p) => before.has(p) && before.get(p) !== after.get(p));
  // A re-add leaves the listing as it was; find the entry by what it points at.
  const same = localPath === null
    ? [packageNameOf(spec)].filter((p) => after.has(p))
    : [...after].filter(([, value]) => value.startsWith("file:") && resolve(folder, value.slice("file:".length)) === localPath).map(([p]) => p);
  const candidates = added.length + changed.length > 0 ? [...added, ...changed] : same;

  const d = ctx.discover(undefined);
  const found = candidates.map((p) => d.extensions.find((e) => e.packageName === p)).filter((e) => e !== undefined);
  if (found.length === 0) {
    const names = candidates.length > 0 ? candidates : [spec];
    ctx.err(`Error: ${names.join(", ")} is not an n-dx extension: its package.json has no ndx.extension block.`);
    if (added.length > 0) {
      await ctx.runNpm(["uninstall", ...added, "--no-audit", "--no-fund"], { cwd: folder });
      ctx.err("It was uninstalled again.");
    }
    return 1;
  }
  for (const ext of found) {
    const label = ext.name ?? ext.packageName;
    const { state, reason } = stateOf(d, ext, ctx.ndxVersion);
    ctx.out(`Added ${ext.packageName}@${ext.version ?? "?"} as '${label}' (${state}${reason ? `: ${reason}` : ""}).`);
    if (ext.source !== "user") ctx.out(`Note: the ${ext.source} copy at ${ext.dir} takes precedence over it.`);
    if (state === "unapproved") ctx.out(`Approve it with 'ndx extensions enable ${label}'.`);
    else if (state !== "enabled") ctx.out("Run 'ndx extensions doctor' to see what to fix.");
  }
  return 0;
}

/**
 * @param {Context} ctx
 * @param {string | undefined} name
 * @param {boolean} purge
 */
async function remove(ctx, name, purge) {
  if (name === undefined) return notFound(ctx, "remove", name);
  const d = ctx.discover(undefined);
  const folder = userFolder(d.home);
  const ext = find(d, name);
  const listed = listedPackages(folder);

  /** @type {string | undefined} */
  let packageName;
  if (ext && (ext.source === "user" || ext.shadowed.some((s) => s.source === "user"))) packageName = ext.packageName;
  else if (listed.has(name)) packageName = name;

  if (packageName === undefined) {
    if (!ext) return notFound(ctx, "remove", name);
    ctx.err(`Error: '${name}' is not installed by 'ndx extensions add'; it comes from the ${ext.source} source (${ext.dir}).`);
    ctx.err(`Hint: ${removalHint(ext, d.home)}`);
    return 1;
  }

  const code = await ctx.runNpm(["uninstall", packageName, "--no-audit", "--no-fund"], { cwd: folder });
  if (code !== 0) {
    ctx.err(`Error: npm uninstall ${packageName} failed (exit ${code}).`);
    return 1;
  }
  // The user copy won over another copy, which takes over now that it is gone.
  const successor = ext?.source === "user" ? ext.shadowed.find((s) => s.source !== "user") : undefined;
  if (!ext || ext.source === "user") {
    updateExtensionsFile(d.home, (file) => {
      forgetApproval(file, packageName);
      if (ext) setDisabled(file, stateKey(ext), false);
    });
    ctx.out(`Removed ${packageName}.`);
    if (successor) ctx.out(`The ${successor.source} copy at ${successor.dir} now applies.`);
  } else {
    // The user copy was shadowed; the approval and the disable belong to the copy still in use.
    ctx.out(`Removed the user copy of ${packageName}. The ${ext.source} copy at ${ext.dir} is still installed and still used.`);
  }

  if (purge) {
    const extName = ext?.name;
    if (!isExtensionNameSlug(extName)) {
      ctx.err(`Nothing purged: ${packageName} declares no valid extension name, so it has no state folder.`);
    } else if (ext && ext.source !== "user") {
      ctx.err(`Nothing purged: the ${ext.source} copy still uses the state folder of '${extName}'.`);
    } else if (successor) {
      ctx.err(`Nothing purged: the ${successor.source} copy at ${successor.dir} now uses the state folder of '${extName}'.`);
    } else {
      const stateDir = join(d.home, EXTENSION_STATE_DIRNAME, extName);
      nodeFs.rmSync(stateDir, { recursive: true, force: true });
      ctx.out(`Deleted its state folder ${stateDir}.`);
    }
  }
  return 0;
}

/**
 * Where to remove an extension that `ndx extensions add` did not install.
 *
 * @param {DiscoveredExtension} ext
 * @param {string} home
 */
function removalHint(ext, home) {
  switch (ext.source) {
    case "project": return `Remove ${ext.packageName} from the project's package.json, or disable it with 'ndx extensions disable ${stateKey(ext)}'.`;
    case "global": return `Uninstall it globally (npm uninstall -g ${ext.packageName}), or disable it with 'ndx extensions disable ${stateKey(ext)}'.`;
    default: return `Remove ${ext.dir} from extensions.paths in ${join(home, "config.json")}.`;
  }
}

// ── enable and disable ───────────────────────────────────────────────────────

/**
 * @param {Context} ctx
 * @param {string | undefined} name
 * @param {boolean} yes
 */
async function enable(ctx, name, yes) {
  const d = ctx.discover(undefined);
  const ext = name === undefined ? undefined : find(d, name);
  if (!ext) return notFound(ctx, "enable", name);
  const label = stateKey(ext);
  const before = stateOf(d, ext, ctx.ndxVersion);
  if (["invalid", "conflict", "incompatible"].includes(before.state)) {
    ctx.err(`Error: '${label}' cannot be enabled: ${before.state} — ${before.reason}.`);
    ctx.err("Hint: Run 'ndx extensions doctor' for the fix.");
    return 1;
  }
  if (before.state === "enabled") {
    ctx.out(`'${label}' is already enabled.`);
    return 0;
  }

  const wasDisabled = before.state === "disabled";
  // Clearing `disable` may reveal that an approval is missing or out of date.
  const pending = extensionState(ext, {
    file: { ...d.file, disabled: { ...d.file.disabled, [label]: undefined } },
    ndxVersion: ctx.ndxVersion,
    projectDir: d.projectDir,
  });
  const approve = pending.state === "unapproved";
  if (approve) {
    for (const line of describeForApproval(ext, pending.reason)) ctx.out(line);
    if (!yes) {
      if (!ctx.confirm) {
        ctx.err(`Error: '${label}' needs your approval, and there is no terminal to ask on.`);
        ctx.err(`Hint: Run 'ndx extensions enable ${label} --yes' to approve it without a prompt.`);
        return 2;
      }
      if (!(await ctx.confirm(`Approve and enable '${label}'?`))) {
        ctx.err(`'${label}' was not approved.`);
        return 1;
      }
    }
  }
  updateExtensionsFile(d.home, (file) => {
    if (wasDisabled) setDisabled(file, label, false);
    if (approve) recordApproval(file, ext, { projectDir: d.projectDir });
  });
  ctx.out(`Enabled '${label}'.`);
  return 0;
}

/**
 * @param {Context} ctx
 * @param {string | undefined} name
 */
function disable(ctx, name) {
  const d = ctx.discover(undefined);
  const ext = name === undefined ? undefined : find(d, name);
  if (!ext) return notFound(ctx, "disable", name);
  const label = stateKey(ext);
  updateExtensionsFile(d.home, (file) => setDisabled(file, label, true));
  ctx.out(`Disabled '${label}'. Its approval, config and state folder are kept; 'ndx extensions enable ${label}' turns it back on.`);
  return 0;
}

// ── doctor ───────────────────────────────────────────────────────────────────

/**
 * @param {Context} ctx
 * @param {string | undefined} dir
 */
function doctor(ctx, dir) {
  const d = ctx.discover(dir);
  const problems = doctorProblems(d, ctx.ndxVersion);
  for (const line of problems) ctx.out(line);
  if (problems.length > 0) {
    ctx.err(`${problems.length} problem${problems.length === 1 ? "" : "s"} found.`);
    return 1;
  }
  ctx.out(`No problems found in ${d.extensions.length} extension${d.extensions.length === 1 ? "" : "s"}.`);
  return 0;
}

/**
 * Every problem, one line each, every line ending in its fix.
 *
 * @param {Discovery} d
 * @param {string} ndxVersion
 * @returns {string[]}
 */
export function doctorProblems(d, ndxVersion) {
  /** @type {string[]} */
  const lines = [];
  for (const error of d.errors) lines.push(`${error.path}: ${error.message} — fix: ${discoveryErrorFix(error, d.home)}`);

  const folder = userFolder(d.home);
  for (const packageName of listedPackages(folder).keys()) {
    if (!nodeFs.existsSync(join(folder, "node_modules", ...packageName.split("/"), "package.json"))) {
      lines.push(`${packageName}: listed in ${join(folder, "package.json")} but not installed — fix: run 'ndx extensions add ${packageName}', or 'ndx extensions remove ${packageName}'`);
    }
  }

  for (const ext of d.extensions) {
    for (const problem of ext.problems) lines.push(formatProblem(problem));
    for (const c of ext.conflicts) {
      lines.push(`${ext.packageName}: ${c.names.map((n) => `"${n}"`).join(", ")} also claimed by ${c.packageName} (${c.dir}) — fix: remove one of the two packages`);
    }
    const m = ext.manifest;
    if (!m) continue;
    const { state, reason } = extensionState(ext, { file: d.file, ndxVersion, projectDir: d.projectDir });
    if (state === "incompatible") {
      lines.push(`${ext.packageName}: ndx.extension.ndxVersion ${reason} — fix: install a version of ${ext.packageName} that supports n-dx ${ndxVersion}, or a matching n-dx`);
    }
    /** @type {Array<[string, string | undefined]>} */
    const paths = [
      ...(m.commands ?? []).map((c, i) => /** @type {[string, string]} */ ([`ndx.extension.commands[${i}].bin`, c.bin])),
      ["ndx.extension.sidecar.bin", m.sidecar?.bin],
      ["ndx.extension.configSchema", m.configSchema],
    ];
    for (const [path, value] of paths) {
      if (value === undefined) continue;
      if (!isFile(join(ext.dir, value))) {
        lines.push(`${ext.packageName}: ${path} "${value}" does not exist in ${ext.dir} — fix: reinstall ${ext.packageName}, or correct the path in its package.json`);
      }
    }
  }
  return lines;
}

/**
 * @param {import("./extension-discovery.js").DiscoveryError} error
 * @param {string} home
 */
function discoveryErrorFix(error, home) {
  if (error.path === join(home, EXTENSIONS_CACHE_FILE)) return `fix or delete ${error.path}; deleting it forgets every extension approval`;
  if (error.path === join(home, "config.json")) return `correct extensions.paths in ${error.path}`;
  return `remove the path from extensions.paths in ${join(home, "config.json")}, or give its package.json an ndx.extension block`;
}

// ── user folder and npm ──────────────────────────────────────────────────────

/** @param {string} home */
function userFolder(home) {
  return join(home, USER_EXTENSIONS_DIRNAME);
}

/**
 * Give the user extensions folder a `package.json`, so npm installs there and
 * never walks up into a project.
 *
 * @param {string} folder
 */
function ensureUserFolder(folder) {
  nodeFs.mkdirSync(folder, { recursive: true });
  const listing = join(folder, "package.json");
  if (nodeFs.existsSync(listing)) return;
  const pkg = {
    name: "ndx-user-extensions",
    private: true,
    description: "Extensions installed with 'ndx extensions add'. Managed by n-dx; edit with 'ndx extensions'.",
    dependencies: {},
  };
  nodeFs.writeFileSync(listing, `${JSON.stringify(pkg, null, 2)}\n`);
}

/**
 * The user folder's `package.json` dependencies: package name → the spec npm
 * saved for it (`^1.2.0`, `file:../../checkout`, …).
 *
 * @param {string} folder
 * @returns {Map<string, string>}
 */
function listedPackages(folder) {
  let pkg;
  try {
    pkg = JSON.parse(nodeFs.readFileSync(join(folder, "package.json"), "utf8"));
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === "ENOENT") return new Map();
    throw new Error(`${join(folder, "package.json")} cannot be read: ${/** @type {Error} */ (error).message}`);
  }
  const deps = pkg && typeof pkg.dependencies === "object" && pkg.dependencies !== null ? pkg.dependencies : {};
  return new Map(Object.entries(deps).map(([name, value]) => [name, String(value)]));
}

/**
 * The absolute path an npm spec names on disk, or `null` for a registry,
 * git or URL spec. npm reads a spec as a path when it starts with `.`, `/`,
 * `\`, `~/` or a drive letter, has a `file:` prefix, or ends in `.tgz`,
 * `.tar.gz` or `.tar`.
 *
 * @param {string} spec
 * @param {string} cwd  Where the user ran the command.
 * @returns {string | null}
 */
export function localSpecPath(spec, cwd) {
  const path = spec.startsWith("file:") ? spec.slice("file:".length) : spec;
  if (/^~[\\/]/.test(path)) return resolve(homedir(), path.slice(2));
  const isPath = spec.startsWith("file:")
    || /^(\.\.?([\\/]|$)|[\\/]|[A-Za-z]:)/.test(path)
    || (/\.(tgz|tar\.gz|tar)$/i.test(path) && !/^[a-z][a-z0-9+.-]*:\/\//i.test(path));
  return isPath ? resolve(cwd, path) : null;
}

/**
 * The package name in an npm spec, when it has one: `@scope/name@1.2` → `@scope/name`.
 *
 * @param {string} spec
 */
function packageNameOf(spec) {
  const at = spec.indexOf("@", 1);
  return at === -1 ? spec : spec.slice(0, at);
}

/** @param {string} path */
function isFile(path) {
  return nodeFs.statSync(path, { throwIfNoEntry: false })?.isFile() ?? false;
}

/**
 * @param {string[]} args
 * @param {{cwd: string}} options
 * @returns {Promise<number>}
 */
function defaultRunNpm(args, { cwd }) {
  return new Promise((resolvePromise, reject) => {
    const child = spawnCli("npm", args, { cwd, stdio: "inherit" });
    child.on("error", reject);
    child.on("close", (code) => resolvePromise(code ?? 1));
  });
}

/**
 * A yes/no prompt on the terminal, or `undefined` when stdin or stdout is not
 * a TTY. `ndx <name>` uses it to ask on an extension's first run.
 *
 * @returns {((question: string) => Promise<boolean>) | undefined}
 */
export function terminalConfirm() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return undefined;
  return async (/** @type {string} */ question) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      return /^y(es)?$/i.test((await rl.question(`${question} [y/N] `)).trim());
    } finally {
      rl.close();
    }
  };
}

/** `@n-dx/core`'s own version. */
function ownVersion() {
  const pkg = JSON.parse(nodeFs.readFileSync(join(dirname(fileURLToPath(import.meta.url)), "package.json"), "utf8"));
  return String(pkg.version);
}
