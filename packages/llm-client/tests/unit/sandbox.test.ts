import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildBwrapArgs,
  buildSeatbeltProfile,
  detectSandboxBackend,
  gitControlPathsFor,
  maskedProjectPathsFor,
  nodeToolchainRoots,
  readOnlyProjectPathsFor,
  removeSandboxPlaceholders,
  resolveSandboxSetting,
  wrapInSandbox,
  wrapShellInSandbox,
  type SandboxPolicy,
} from "../../src/sandbox.js";

const policy: SandboxPolicy = {
  kind: "tool",
  projectDir: "/private/tmp/proj",
  tmpDir: "/private/tmp/scratch",
  network: "none",
  homeDir: "/Users/op",
  readOnlyRoots: ["/Users/op/.nvm/versions/node/v22"],
};

describe("detectSandboxBackend", () => {
  it("picks Seatbelt on macOS when sandbox-exec exists", () => {
    expect(detectSandboxBackend("darwin", { exists: (p) => p === "/usr/bin/sandbox-exec", usable: () => true })).toEqual({ name: "seatbelt", available: true });
  });
  it("reports a sandbox-exec that cannot apply a profile (nested sandbox)", () => {
    const b = detectSandboxBackend("darwin", { exists: () => true, usable: () => false });
    expect(b).toMatchObject({ name: "seatbelt", available: false });
    expect(b.reason).toMatch(/cannot apply/);
  });
  it("reports a missing sandbox-exec", () => {
    const b = detectSandboxBackend("darwin", { exists: () => false });
    expect(b.available).toBe(false);
    expect(b.reason).toMatch(/sandbox-exec/);
  });
  it("picks bubblewrap on Linux when bwrap is on PATH", () => {
    expect(detectSandboxBackend("linux", { onPath: (n) => n === "bwrap", usable: () => true })).toEqual({ name: "bwrap", available: true });
    expect(detectSandboxBackend("linux", { onPath: () => true, usable: () => false }).reason).toMatch(/namespaces/);
    expect(detectSandboxBackend("linux", { onPath: () => false }).reason).toMatch(/bwrap/);
  });
  it("has no backend on Windows", () => {
    const b = detectSandboxBackend("win32", {});
    expect(b).toMatchObject({ name: "none", available: false });
  });
});

describe("buildSeatbeltProfile", () => {
  const profile = buildSeatbeltProfile(policy);

  it("denies by default and grants the project and scratch read-write", () => {
    expect(profile.startsWith("(version 1)\n(deny default)\n")).toBe(true);
    expect(profile).toContain('(allow file-read* file-write* (subpath "/private/tmp/proj") (subpath "/private/tmp/scratch"))');
  });
  it("grants the toolchain read-only", () => {
    expect(profile).toMatch(/\(allow file-read\* .*\(subpath "\/usr"\).*\(subpath "\/Users\/op\/\.nvm\/versions\/node\/v22"\)\)/);
  });
  it("denies all network for tool children", () => {
    expect(profile).toContain("(deny network*)");
    expect(profile).not.toContain("remote tcp");
  });
  it("masks project state and credential directories after the grants", () => {
    const deny = profile.lastIndexOf("(deny file-read* file-write*");
    const grant = profile.indexOf("(allow file-read* file-write*");
    expect(deny).toBeGreaterThan(grant);
    const denyLine = profile.slice(deny);
    for (const p of ["/private/tmp/proj/.hench", "/private/tmp/proj/.rex", "/private/tmp/proj/.ndx", "/Users/op/.ssh", "/Users/op/.aws", "/Users/op/.config/gh", "/Users/op/Library/Keychains"]) {
      expect(denyLine).toContain(`(subpath "${p}")`);
    }
  });
  it("keeps .rex readable for the vendor CLI but masks the hench config", () => {
    const vendor = buildSeatbeltProfile({ ...policy, kind: "vendor-cli", network: "vendor", readWriteRoots: ["/Users/op/.claude"] });
    const denyLine = vendor.slice(vendor.lastIndexOf("(deny file-read* file-write*"));
    expect(denyLine).not.toContain('"/private/tmp/proj/.rex"');
    expect(denyLine).toContain('"/private/tmp/proj/.hench/config.json"');
    expect(vendor).toContain('(subpath "/Users/op/.claude")');
    expect(vendor).toContain('(allow network-outbound (remote tcp "*:443"))');
    expect(vendor).toContain('(allow network-bind network-inbound (local ip "localhost:*"))');
    expect(vendor).not.toContain("(deny network*)");
  });
  it("opens the network only when asked", () => {
    expect(buildSeatbeltProfile({ ...policy, network: "allow" })).toContain("(allow network*)");
  });
  it("escapes quotes in paths", () => {
    const p = buildSeatbeltProfile({ ...policy, projectDir: '/private/tmp/we"ird' });
    expect(p).toContain('(subpath "/private/tmp/we\\"ird")');
  });
});

describe("buildBwrapArgs", () => {
  const exists = (p: string) => ["/usr", "/bin", "/lib", "/etc", "/private/tmp/proj/.hench", "/Users/op/.ssh"].includes(p);
  const args = buildBwrapArgs(policy, exists);

  it("binds only existing system roots read-only and the project read-write", () => {
    expect(args).toEqual(expect.arrayContaining(["--ro-bind", "/usr", "/usr", "--bind", "/private/tmp/proj", "/private/tmp/proj"]));
    expect(args).not.toContain("/lib64");
    expect(args.join(" ")).not.toContain("--ro-bind / /");
  });
  it("masks existing project state and credential dirs with an empty tmpfs", () => {
    const joined = args.join(" ");
    expect(joined).toContain("--tmpfs /private/tmp/proj/.hench");
    expect(joined).not.toContain("--tmpfs /private/tmp/proj/.rex");
    expect(joined).toContain("--tmpfs /Users/op/.ssh");
  });
  it("unshares the network for tool children only", () => {
    expect(args).toContain("--unshare-net");
    expect(buildBwrapArgs({ ...policy, network: "vendor" }, exists)).not.toContain("--unshare-net");
  });
  it("sets TMPDIR and the working directory", () => {
    expect(args.join(" ")).toContain("--setenv TMPDIR /private/tmp/scratch");
    expect(args.join(" ")).toContain("--chdir /private/tmp/proj");
  });
});

describe("wrapInSandbox", () => {
  it("prefixes sandbox-exec with the inline profile and passes argv verbatim", () => {
    const inv = wrapInSandbox("sh", ["-c", "echo $(id); rm -rf x"], policy, { name: "seatbelt", available: true });
    expect(inv.file).toBe("/usr/bin/sandbox-exec");
    expect(inv.args[0]).toBe("-p");
    expect(inv.args[1]).toContain("(deny default)");
    expect(inv.args.slice(2)).toEqual(["sh", "-c", "echo $(id); rm -rf x"]);
    expect(inv.env).toEqual({ TMPDIR: "/private/tmp/scratch" });
  });
  it("prefixes bwrap with its arguments and a -- separator", () => {
    const inv = wrapInSandbox("node", ["-e", "1"], policy, { name: "bwrap", available: true });
    expect(inv.file).toBe("bwrap");
    const sep = inv.args.indexOf("--");
    expect(inv.args.slice(sep + 1)).toEqual(["node", "-e", "1"]);
  });
  it("refuses an unavailable backend", () => {
    expect(() => wrapInSandbox("node", [], policy, { name: "none", available: false, reason: "no backend" })).toThrow(/no backend/);
  });
});

describe("nodeToolchainRoots", () => {
  it("derives the install prefix from the node binary and adds known store variables", () => {
    const roots = nodeToolchainRoots({ PNPM_HOME: "/Users/op/Library/pnpm", NVM_DIR: "/Users/op/.nvm" }, "/Users/op/.nvm/versions/node/v22.1.0/bin/node");
    expect(roots).toEqual(["/Users/op/.nvm/versions/node/v22.1.0", "/Users/op/Library/pnpm", "/Users/op/.nvm"]);
  });
  it("keeps a bare binary directory when it is not named bin", () => {
    expect(nodeToolchainRoots({}, "/opt/node/node")).toEqual(["/opt/node"]);
  });
});

describe("resolveSandboxSetting", () => {
  function project(files: Record<string, unknown>): { dir: string; home: string } {
    const dir = mkdtempSync(join(tmpdir(), "sbx-proj-"));
    const home = mkdtempSync(join(tmpdir(), "sbx-home-"));
    for (const [rel, body] of Object.entries(files)) {
      const target = rel.startsWith("~/") ? join(home, rel.slice(2)) : join(dir, rel);
      mkdirSync(join(target, ".."), { recursive: true });
      writeFileSync(target, JSON.stringify(body));
    }
    return { dir, home };
  }

  it("defaults to on with no tool network", () => {
    const { dir, home } = project({});
    expect(resolveSandboxSetting(dir, { env: {}, ndxHome: home })).toEqual({ mode: "on", toolNetwork: "none", source: "default" });
  });
  it("ignores the tracked project config entirely", () => {
    const { dir, home } = project({ ".n-dx.json": { sandbox: { mode: "off", network: "allow" } }, ".hench/config.json": { sandbox: { mode: "off" } } });
    expect(resolveSandboxSetting(dir, { env: {}, ndxHome: home })).toMatchObject({ mode: "on", toolNetwork: "none" });
  });
  it("honours the git-ignored local config", () => {
    const { dir, home } = project({ ".n-dx.local.json": { sandbox: { mode: "off" } } });
    expect(resolveSandboxSetting(dir, { env: {}, ndxHome: home })).toMatchObject({ mode: "off", source: "local-config" });
  });
  it("honours the user config in ndx home", () => {
    const { dir, home } = project({ "~/config.json": { sandbox: { network: "allow" } } });
    expect(resolveSandboxSetting(dir, { env: {}, ndxHome: home })).toMatchObject({ mode: "on", toolNetwork: "allow", source: "user-config" });
  });
  it("lets the environment win over both files", () => {
    const { dir, home } = project({ ".n-dx.local.json": { sandbox: { mode: "off" } } });
    expect(resolveSandboxSetting(dir, { env: { NDX_SANDBOX: "on" }, ndxHome: home })).toMatchObject({ mode: "on", source: "env" });
  });
  it("ignores unrecognised values rather than trusting them", () => {
    const { dir, home } = project({ ".n-dx.local.json": { sandbox: { mode: "disabled", network: "everything" } } });
    expect(resolveSandboxSetting(dir, { env: { NDX_SANDBOX: "false" }, ndxHome: home })).toEqual({ mode: "on", toolNetwork: "none", source: "default" });
  });
});

describe("vendor-CLI policy", () => {
  const vendor: SandboxPolicy = {
    kind: "vendor-cli",
    projectDir: "/private/tmp/proj",
    tmpDir: "/private/tmp/scratch",
    network: "vendor",
    homeDir: "/Users/op",
    readWriteRoots: ["/Users/op/.claude"],
    readWritePrefixes: ["/Users/op/.claude.json"],
  };

  it("lets the CLI rewrite its config by temp-and-rename beside the original", () => {
    const profile = buildSeatbeltProfile(vendor);
    expect(profile).toContain('(regex #"^/Users/op/\\.claude\\.json")');
    expect(profile).toContain('(subpath "/Users/op/.claude")');
  });

  it("keeps the keychain reachable for the CLI's own login, and every other credential dir denied", () => {
    const deny = buildSeatbeltProfile(vendor).split("\n").find((l) => l.startsWith("(deny file-read* file-write*"))!;
    expect(deny).not.toContain("Library/Keychains");
    expect(deny).toContain('"/Users/op/.ssh"');
    expect(deny).toContain('"/Users/op/.aws"');
    const toolDeny = buildSeatbeltProfile({ ...vendor, kind: "tool" }).split("\n").find((l) => l.startsWith("(deny file-read* file-write*"))!;
    expect(toolDeny).toContain("Library/Keychains");
  });

  it("gives the CLI an empty home under bubblewrap, with only its config bound in", () => {
    const args = buildBwrapArgs(vendor, () => true).join(" ");
    expect(args).toContain("--tmpfs /Users/op");
    expect(args.indexOf("--tmpfs /Users/op ")).toBeLessThan(args.indexOf("--bind-try /Users/op/.claude "));
    expect(args).toContain("--bind-try /Users/op/.claude.json /Users/op/.claude.json");
    expect(buildBwrapArgs({ ...vendor, kind: "tool" }, () => true).join(" ")).not.toContain("--tmpfs /Users/op ");
  });
});

describe("git-hook policy", () => {
  const hook: SandboxPolicy = { ...policy, kind: "git-hook", readWriteRoots: ["/private/tmp/repo/.git"] };

  it("masks no project state, so the hook can read and rewrite the PRD it is committing", () => {
    expect(maskedProjectPathsFor("git-hook", "/private/tmp/proj")).toEqual([]);
    const profile = buildSeatbeltProfile(hook);
    const denyLine = profile.slice(profile.lastIndexOf("(deny file-read* file-write*"));
    expect(denyLine).not.toContain('"/private/tmp/proj/.rex"');
    expect(denyLine).not.toContain('"/private/tmp/proj/.hench"');
    // Credentials stay denied, the keychain included.
    expect(denyLine).toContain('(subpath "/Users/op/.ssh")');
    expect(denyLine).toContain('(subpath "/Users/op/Library/Keychains")');
  });

  it("keeps hench's state and the operator's local config read-only", () => {
    const readOnly = readOnlyProjectPathsFor("git-hook", "/private/tmp/proj");
    expect(readOnly).toEqual(expect.arrayContaining([
      "/private/tmp/proj/.hench",
      "/private/tmp/proj/.ndx/hench",
      "/private/tmp/proj/.n-dx.local.json",
    ]));
    expect(readOnlyProjectPathsFor("tool", "/private/tmp/proj")).toEqual([]);

    const profile = buildSeatbeltProfile(hook);
    const denyWrite = profile.indexOf("(deny file-write* ");
    expect(denyWrite).toBeGreaterThan(profile.indexOf("(allow file-read* file-write*"));
    const line = profile.slice(denyWrite, profile.indexOf("\n", denyWrite));
    expect(line).toContain('(subpath "/private/tmp/proj/.hench")');
    expect(line).toContain('(literal "/private/tmp/proj/.n-dx.local.json")');
    expect(line).not.toContain(".rex");
  });

  it("grants a linked worktree's git directory read-write", () => {
    expect(buildSeatbeltProfile(hook)).toContain('(subpath "/private/tmp/repo/.git")');
  });

  it("binds hench's state read-only under bubblewrap instead of hiding it", () => {
    const exists = (p: string) => ["/usr", "/private/tmp/proj/.hench", "/private/tmp/proj/.rex"].includes(p);
    const joined = buildBwrapArgs(hook, exists).join(" ");
    expect(joined).toContain("--ro-bind /private/tmp/proj/.hench /private/tmp/proj/.hench");
    expect(joined).not.toContain("--tmpfs /private/tmp/proj/.hench");
    expect(joined).not.toContain("/private/tmp/proj/.rex");
    expect(joined.indexOf("--ro-bind /private/tmp/proj/.hench")).toBeGreaterThan(joined.indexOf("--bind /private/tmp/proj "));
  });
});

/** A real, realpath'd temp directory: Seatbelt and the git walk see resolved paths. */
function realTemp(prefix: string): string {
  return realpathSync(mkdtempSync(join(tmpdir(), prefix)));
}

/**
 * The backends exist only on macOS and Linux, and these cases compare POSIX
 * paths the builders join with the host separator; on Windows they would
 * assert path spelling, not policy.
 */
const posixOnly = describe.skipIf(process.platform === "win32");

function denyWriteLines(profile: string): string {
  return profile.split("\n").filter((l) => l.startsWith("(deny file-write* ")).join("\n");
}

posixOnly("git control files", () => {
  function mainRepo(): string {
    const dir = realTemp("sbx-git-");
    mkdirSync(join(dir, ".git", "hooks"), { recursive: true });
    writeFileSync(join(dir, ".git", "config"), "[core]\n");
    return dir;
  }

  /** A linked worktree: `<wt>/.git` names `<common>/worktrees/wt`, whose `commondir` leads back. */
  function linkedWorktree(): { wt: string; common: string; own: string } {
    const root = realTemp("sbx-wt-");
    const common = join(root, "main", ".git");
    const own = join(common, "worktrees", "wt");
    mkdirSync(own, { recursive: true });
    writeFileSync(join(common, "config"), "[core]\n");
    writeFileSync(join(own, "commondir"), "../..\n");
    const wt = join(root, "wt");
    mkdirSync(wt);
    writeFileSync(join(wt, ".git"), `gitdir: ${own}\n`);
    return { wt, common, own };
  }

  it("finds the project's git directory and its control files", () => {
    const dir = mainRepo();
    const git = gitControlPathsFor(dir);
    expect(git.dirs).toEqual([join(dir, ".git")]);
    expect(git.readOnly).toEqual(expect.arrayContaining([
      join(dir, ".git", "config"),
      join(dir, ".git", "config.worktree"),
      join(dir, ".git", "commondir"),
      join(dir, ".git", "hooks"),
      join(dir, ".git", "info", "attributes"),
    ]));
  });

  it("follows a linked worktree's .git file to its own and the common git directory", () => {
    const { wt, common, own } = linkedWorktree();
    const git = gitControlPathsFor(wt);
    expect(git.dirs).toEqual([own, common]);
    expect(git.readOnly).toEqual(expect.arrayContaining([
      join(wt, ".git"),
      join(own, "commondir"),
      join(common, "config"),
      join(common, "hooks"),
    ]));
  });

  it.each(["tool", "vendor-cli", "git-hook"] as const)("keeps .git/config read-only to a %s child under Seatbelt", (kind) => {
    const dir = mainRepo();
    const profile = buildSeatbeltProfile({ ...policy, kind, projectDir: dir });
    const denies = denyWriteLines(profile);
    expect(denies).toContain(`(subpath "${dir}/.git/config")`);
    expect(denies).toContain(`(subpath "${dir}/.git/hooks")`);
    expect(denies).toContain(`(subpath "${dir}/.git/commondir")`);
    expect(denies).toContain(`(subpath "${dir}/.git/info/attributes")`);
    // The directory entry itself cannot be renamed away, but stays writable inside.
    expect(denies).toContain(`(literal "${dir}/.git")`);
    expect(denies).not.toContain(`(subpath "${dir}/.git")`);
    // The deny comes after the project grant, so it wins.
    expect(profile.indexOf(`(subpath "${dir}/.git/config")`)).toBeGreaterThan(profile.indexOf(`(allow file-read* file-write* (subpath "${dir}")`));
  });

  it("protects the common directory's config for a vendor CLI granted a linked worktree's git directory", () => {
    const { wt, common } = linkedWorktree();
    const vendorPolicy: SandboxPolicy = { ...policy, kind: "vendor-cli", network: "vendor", projectDir: wt, readWriteRoots: [common] };
    const denies = denyWriteLines(buildSeatbeltProfile(vendorPolicy));
    expect(denies).toContain(`(subpath "${common}/config")`);
    expect(denies).toContain(`(subpath "${wt}/.git")`);

    const args = buildBwrapArgs(vendorPolicy).join(" ");
    expect(args).toContain(`--ro-bind ${common}/config ${common}/config`);
    expect(args).toContain(`--ro-bind ${wt}/.git ${wt}/.git`);
    expect(args).toContain(`--bind ${common} ${common}`);
  });

  it("pins the git directory and binds its config read-only under bubblewrap", () => {
    const dir = mainRepo();
    const args = buildBwrapArgs({ ...policy, projectDir: dir });
    const joined = args.join(" ");
    expect(joined).toContain(`--bind ${dir}/.git ${dir}/.git`);
    expect(joined).toContain(`--ro-bind ${dir}/.git/config ${dir}/.git/config`);
    expect(joined).toContain(`--ro-bind ${dir}/.git/hooks ${dir}/.git/hooks`);
    expect(joined.indexOf(`--ro-bind ${dir}/.git/config`)).toBeGreaterThan(joined.indexOf(`--bind ${dir} `));
    // An absent commondir gets no empty placeholder: git refuses an empty one.
    expect(joined).not.toContain(`${dir}/.git/commondir`);
  });

  it("does not grant a git directory outside every writable root", () => {
    const { wt, common } = linkedWorktree();
    const joined = buildBwrapArgs({ ...policy, projectDir: wt }).join(" ");
    expect(joined).not.toContain(common);
  });

  const backend = detectSandboxBackend();
  it.skipIf(!backend.available)("refuses a confined child's write to .git/config", () => {
    const dir = mainRepo();
    const scratch = realTemp("sbx-scratch-");
    const confined: SandboxPolicy = { ...policy, projectDir: dir, tmpDir: scratch, readOnlyRoots: [] };
    const run = (command: string) => {
      const inv = wrapShellInSandbox(command, confined, backend);
      return spawnSync(inv.file, inv.args, { cwd: dir, env: { ...process.env, ...inv.env } }).status;
    };
    // The control: the same sandbox writes the project and git's own state.
    expect(run("echo ok > ok.txt && echo ref > .git/ORIG_HEAD")).toBe(0);
    expect(run("printf '[core]\\n\\tfsmonitor = evil\\n' >> .git/config")).not.toBe(0);
    expect(run("mv .git .git-moved")).not.toBe(0);
    expect(readFileSync(join(dir, ".git", "config"), "utf-8")).toBe("[core]\n");
    expect(readFileSync(join(dir, "ok.txt"), "utf-8")).toBe("ok\n");
  });
});

describe("vendor network profile", () => {
  const vendorNet: SandboxPolicy = { ...policy, kind: "vendor-cli", network: "vendor" };
  const profile = buildSeatbeltProfile(vendorNet);

  it("resolves through the system resolver's socket, not raw UDP 53", () => {
    expect(profile).not.toContain("udp");
    expect(profile).toContain('(remote unix-socket (subpath "/private/var/run/mDNSResponder"))');
  });
  it("limits Unix sockets to the project and scratch directories", () => {
    expect(profile).not.toMatch(/\(remote unix-socket\)/);
    expect(profile).toContain('(remote unix-socket (subpath "/private/tmp/proj"))');
    expect(profile).toContain('(remote unix-socket (subpath "/private/tmp/scratch"))');
    expect(profile).not.toContain("docker.sock");
  });
  it("never puts a local-address filter on outbound, which would admit all egress", () => {
    expect(profile).not.toMatch(/\(allow network\* \(local ip/);
    expect(profile).not.toMatch(/\(allow network-outbound \(local ip/);
    expect(profile).toContain('(allow network-outbound (remote ip "localhost:*"))');
  });
});

describe("mach-lookup", () => {
  it("allows named services only", () => {
    const profile = buildSeatbeltProfile(policy);
    expect(profile).not.toMatch(/\(allow mach-lookup\)/);
    expect(profile).toContain('(global-name "com.apple.system.opendirectoryd.libinfo")');
    expect(profile).toContain('(global-name "com.apple.logd")');
    expect(profile).toContain('(global-name "com.apple.trustd.agent")');
    expect(profile).not.toContain("pasteboard");
  });
  it("keeps the keychain service for the vendor CLI only", () => {
    expect(buildSeatbeltProfile(policy)).not.toContain('"com.apple.SecurityServer"');
    expect(buildSeatbeltProfile({ ...policy, kind: "vendor-cli", network: "vendor" })).toContain('(global-name "com.apple.SecurityServer")');
  });
  it("gives a network-none child no resolver to leak names through", () => {
    expect(buildSeatbeltProfile(policy)).not.toContain("mDNSResponder");
    expect(buildSeatbeltProfile({ ...policy, network: "allow" })).toContain('(global-name "com.apple.mDNSResponder")');
  });
  it("never allows Apple Events or Launch Services opens", () => {
    const profile = buildSeatbeltProfile({ ...policy, kind: "vendor-cli", network: "vendor" });
    expect(profile).not.toContain("appleevent-send");
    expect(profile).not.toContain("lsopen");
    expect(profile).not.toContain("com.apple.coreservices.appleevents");
  });
});

posixOnly("toolchain roots and credentials", () => {
  const roots: SandboxPolicy = { ...policy, readOnlyRoots: ["/Users/op", "/Users", "/", "/Users/op/go"], ndxHome: "/Users/op/.ndx" };

  it("drops a read-only root equal to or above the home directory", () => {
    const profile = buildSeatbeltProfile(roots);
    const grant = profile.split("\n").find((l) => l.startsWith("(allow file-read* (subpath \"/usr\")"))!;
    expect(grant).toContain('(subpath "/Users/op/go")');
    expect(grant).not.toContain('(subpath "/Users/op")');
    expect(grant).not.toContain('(subpath "/Users")');
    expect(grant).not.toContain('(subpath "/")');
    const args = buildBwrapArgs(roots, () => true).join(" ");
    expect(args).toContain("--ro-bind-try /Users/op/go /Users/op/go");
    expect(args).not.toContain("--ro-bind-try /Users/op /Users/op");
    expect(args).not.toContain("--ro-bind-try / /");
  });

  it("denies the added credential files and ndx home", () => {
    const deny = buildSeatbeltProfile(roots).split("\n").find((l) => l.startsWith("(deny file-read* file-write*"))!;
    for (const p of [".git-credentials", ".cargo/credentials.toml", ".codex/auth.json", ".pypirc"]) {
      expect(deny).toContain(`(subpath "/Users/op/${p}")`);
    }
    expect(deny).toContain('(subpath "/Users/op/.ndx")');
  });

  it("denies the vendor CLI only the dashboard token in ndx home", () => {
    const deny = buildSeatbeltProfile({ ...roots, kind: "vendor-cli", network: "vendor" }).split("\n").find((l) => l.startsWith("(deny file-read* file-write*"))!;
    expect(deny).toContain('(literal "/Users/op/.ndx/auth.token")');
    expect(deny).not.toContain('(subpath "/Users/op/.ndx")');
  });

  it("masks a credential file under bubblewrap with an empty file, not a tmpfs", () => {
    const secrets = new Set(["/Users/op/.npmrc", "/Users/op/.ssh"]);
    const args = buildBwrapArgs(roots, (p) => secrets.has(p) || p === "/usr", (p) => p !== "/Users/op/.npmrc").join(" ");
    expect(args).toContain("--ro-bind /dev/null /Users/op/.npmrc");
    expect(args).not.toContain("--tmpfs /Users/op/.npmrc");
    expect(args).toContain("--tmpfs /Users/op/.ssh");
  });
});

posixOnly("bubblewrap absent paths", () => {
  const absent = () => false;

  it("covers an absent .ndx container with a read-only placeholder when asked", () => {
    const joined = buildBwrapArgs({ ...policy, placeholders: true }, absent).join(" ");
    expect(joined).toContain("--ro-bind /dev/null /private/tmp/proj/.ndx");
    // Placed after the project bind, so the mount lands inside it.
    expect(joined.indexOf("--ro-bind /dev/null /private/tmp/proj/.ndx")).toBeGreaterThan(joined.indexOf("--bind /private/tmp/proj "));
  });

  it("covers the container for every kind, the vendor CLI and hooks included", () => {
    for (const kind of ["vendor-cli", "git-hook"] as const) {
      const joined = buildBwrapArgs({ ...policy, kind, network: "vendor", placeholders: true }, absent).join(" ");
      expect(joined).toContain("--ro-bind /dev/null /private/tmp/proj/.ndx");
      expect(joined.split("/private/tmp/proj/.ndx ").length - 1).toBe(1);
    }
  });

  it("creates nothing on the host unless the caller opts in", () => {
    expect(buildBwrapArgs(policy, absent).join(" ")).not.toContain("/dev/null /private/tmp/proj");
  });

  it("leaves the unused legacy paths alone once .ndx exists", () => {
    const ndxOnly = (p: string) => p === "/private/tmp/proj/.ndx";
    const joined = buildBwrapArgs({ ...policy, kind: "vendor-cli", network: "vendor", placeholders: true }, ndxOnly).join(" ");
    expect(joined).not.toContain("/private/tmp/proj/.hench");
    // The ndx layout's hench config is absent: its highest missing ancestor is covered.
    expect(joined).toContain("--ro-bind /dev/null /private/tmp/proj/.ndx/hench");
  });

  it("reports the placeholders it made and removes only empty files", () => {
    const dir = realTemp("sbx-ph-");
    const scratch = realTemp("sbx-ph-scratch-");
    const inv = wrapInSandbox("true", [], { ...policy, projectDir: dir, tmpDir: scratch, placeholders: true }, { name: "bwrap", available: true });
    expect(inv.placeholders).toEqual(expect.arrayContaining([join(dir, ".ndx")]));
    // What bwrap leaves behind: an empty regular file at the mount point.
    writeFileSync(join(dir, ".ndx"), "");
    writeFileSync(join(dir, "kept"), "content");
    removeSandboxPlaceholders([join(dir, ".ndx"), join(dir, "kept"), join(dir, "missing")]);
    expect(existsSync(join(dir, ".ndx"))).toBe(false);
    expect(existsSync(join(dir, "kept"))).toBe(true);
  });

  const host = detectSandboxBackend();
  it.skipIf(host.name !== "bwrap" || !host.available)("stops a confined child creating .ndx in a legacy project, and leaves nothing behind", () => {
    const dir = realTemp("sbx-ph-real-");
    const scratch = realTemp("sbx-ph-real-scratch-");
    mkdirSync(join(dir, ".rex"));
    const inv = wrapShellInSandbox("mkdir -p .ndx/rex", { ...policy, projectDir: dir, tmpDir: scratch, readOnlyRoots: [], placeholders: true }, host);
    expect(spawnSync(inv.file, inv.args, { cwd: dir }).status).not.toBe(0);
    removeSandboxPlaceholders(inv.placeholders);
    expect(existsSync(join(dir, ".ndx"))).toBe(false);
  });

  it("binds the resolver's run directory read-only for a networked child", () => {
    expect(buildBwrapArgs({ ...policy, network: "vendor" }, absent).join(" ")).toContain("--ro-bind-try /run/systemd/resolve /run/systemd/resolve");
    expect(buildBwrapArgs(policy, absent).join(" ")).not.toContain("/run/systemd/resolve");
  });
});

describe("resolveSandboxSetting and a committed local config", () => {
  function repoWithLocal(): { dir: string; home: string } {
    const dir = mkdtempSync(join(tmpdir(), "sbx-tracked-"));
    const home = mkdtempSync(join(tmpdir(), "sbx-tracked-home-"));
    writeFileSync(join(dir, ".n-dx.local.json"), JSON.stringify({ sandbox: { mode: "off", network: "allow" } }));
    execFileSync("git", ["init", "-q"], { cwd: dir, stdio: "ignore" });
    return { dir, home };
  }

  it("ignores a .n-dx.local.json the repository commits", () => {
    const { dir, home } = repoWithLocal();
    execFileSync("git", ["add", "-f", ".n-dx.local.json"], { cwd: dir, stdio: "ignore" });
    expect(resolveSandboxSetting(dir, { env: {}, ndxHome: home })).toEqual({ mode: "on", toolNetwork: "none", source: "default" });
  });

  it("still honours an untracked one inside a git work tree", () => {
    const { dir, home } = repoWithLocal();
    expect(resolveSandboxSetting(dir, { env: {}, ndxHome: home })).toMatchObject({ mode: "off", toolNetwork: "allow", source: "local-config" });
  });
});
