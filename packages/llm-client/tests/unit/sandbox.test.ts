import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildBwrapArgs,
  buildSeatbeltProfile,
  detectSandboxBackend,
  maskedProjectPathsFor,
  nodeToolchainRoots,
  readOnlyProjectPathsFor,
  resolveSandboxSetting,
  wrapInSandbox,
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
    expect(vendor).toContain('(allow network* (local ip "localhost:*"))');
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
