import { beforeEach, describe, expect, it, vi } from "vitest";
import { isProtectedCodexConfig } from "../../../src/agent/lifecycle/codex-system-config.js";

const host = vi.hoisted(() => ({ stat: vi.fn(), filesystem: vi.fn(), link: vi.fn(), acl: vi.fn() }));
vi.mock("node:fs", async original => ({
  ...await original<typeof import("node:fs")>(), lstatSync: host.stat, statfsSync: host.filesystem, readlinkSync: host.link,
}));
vi.mock("../../../src/prd/llm-gateway.js", () => ({
  exec: async (bin: string, args: string[]) => ({ exitCode: 0, stdout: host.acl(bin, args), stderr: "" }),
}));

const directory = { uid: 0, mode: 0o755, isDirectory: () => true, isFile: () => false, isSymbolicLink: () => false };
const file = { ...directory, mode: 0o444, isDirectory: () => false, isFile: () => true };
const target = "/etc/codex/config.toml";
describe.skipIf(!["darwin", "linux"].includes(process.platform))("system configuration authority", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    host.stat.mockImplementation((path: string) => path === target ? file : directory);
    host.filesystem.mockReturnValue({ type: process.platform === "darwin" ? 26 : 0xef53 });
    host.acl.mockReturnValue("drwxr-xr-x  1 0 0 0 Jan 1 00:00 /etc\n");
  });
  it("checks ownership even for a read-only leaf", async () => {
    expect(await isProtectedCodexConfig(target)).toBe(true);
    host.stat.mockImplementation((path: string) => path === target ? { ...file, uid: 501 } : directory);
    expect(await isProtectedCodexConfig(target)).toBe(false);
  });
  it("accepts a missing directory only below a protected parent", async () => {
    let mode = 0o755;
    host.stat.mockImplementation((path: string) => {
      if (path === "/etc") return { ...directory, mode };
      if (path === "/etc/codex") throw Object.assign(new Error(), { code: "ENOENT" });
      return directory;
    });
    expect(await isProtectedCodexConfig(target)).toBe(true);
    mode = 0o775;
    expect(await isProtectedCodexConfig(target)).toBe(false);
  });
  it("refuses unreadable metadata and unknown filesystem authority", async () => {
    host.stat.mockImplementationOnce(() => { throw Object.assign(new Error(), { code: "EACCES" }); });
    expect(await isProtectedCodexConfig(target)).toBe(false);
    host.filesystem.mockReturnValue({ type: 0 });
    expect(await isProtectedCodexConfig(target)).toBe(false);
  });
  it.skipIf(process.platform !== "darwin")("checks the canonical /etc target and refuses an extended ACL", async () => {
    host.link.mockReturnValue("private/etc");
    host.stat.mockImplementation((path: string) => {
      if (path === "/etc") return { ...directory, isSymbolicLink: () => true };
      return path === "/private" + target ? file : directory;
    });
    expect(await isProtectedCodexConfig(target)).toBe(true);
    expect(host.stat).toHaveBeenCalledWith("/private/etc");
    host.acl.mockImplementation((_bin, args) => args.at(-1) === "/private/etc"
      ? "drwxr-xr-x+ 1 0 0 0 Jan 1 00:00 /private/etc\n 0: user:fixture allow add_file\n"
      : "drwxr-xr-x  1 0 0 0 Jan 1 00:00 /\n");
    expect(await isProtectedCodexConfig(target)).toBe(false);
    host.link.mockReturnValue("/unverified/target");
    expect(await isProtectedCodexConfig(target)).toBe(false);
  });
});
