/**
 * Owner-only file permissions, both OS branches.
 *
 * Every OS call is injected, so the Windows ACL path is exercised on Linux CI
 * and the POSIX mode path is exercised on a Windows dev box. Without that, each
 * branch would only ever run on the platform it is not written for.
 */
import { describe, expect, it } from "vitest";
import {
  describeUnrestrictedFile,
  OWNER_ONLY_MODE,
  parseIcaclsOutput,
  restrictFileToOwner,
} from "../../packages/core/file-permissions.js";

const WIN_PATH = "C:\\proj\\.n-dx.json";

/** Real `icacls <path>` output shapes, captured on Windows 11. */
const ICACLS_INHERITED = `${WIN_PATH} NT AUTHORITY\\SYSTEM:(I)(F)
                          BUILTIN\\Administrators:(I)(F)
                          HH_PC_1\\smhal:(I)(F)

Successfully processed 1 files; Failed processing 0 files`;

const ICACLS_RESTRICTED = `${WIN_PATH} HH_PC_1\\smhal:(F)

Successfully processed 1 files; Failed processing 0 files`;

/**
 * Fake execFileSyncCli. The first call is the icacls grant; the second reads the
 * ACL back, answering with `readback`.
 */
function makeIcacls(readback, { failOn = null } = {}) {
  const calls = [];
  const impl = (binary, args, options) => {
    calls.push({ binary, args, options });
    if (failOn === calls.length) throw new Error("icacls exploded");
    // The read-back call passes only the path.
    if (args.length === 1) return readback;
    return "";
  };
  impl.calls = calls;
  return impl;
}

describe("parseIcaclsOutput", () => {
  it("parses the path-prefixed first ACE alongside indented ones", () => {
    const aces = parseIcaclsOutput(ICACLS_INHERITED, WIN_PATH);

    expect(aces).toEqual([
      { identity: "NT AUTHORITY\\SYSTEM", flags: ["I", "F"] },
      { identity: "BUILTIN\\Administrators", flags: ["I", "F"] },
      { identity: "HH_PC_1\\smhal", flags: ["I", "F"] },
    ]);
  });

  it("parses a restricted single-entry ACL", () => {
    expect(parseIcaclsOutput(ICACLS_RESTRICTED, WIN_PATH)).toEqual([
      { identity: "HH_PC_1\\smhal", flags: ["F"] },
    ]);
  });

  it("ignores the localized trailing summary line", () => {
    // A translated summary must not be mistaken for an ACE.
    const localized = `${WIN_PATH} HH_PC_1\\smhal:(F)

Se han procesado correctamente 1 archivos`;
    expect(parseIcaclsOutput(localized, WIN_PATH)).toHaveLength(1);
  });

  it("returns nothing for unparseable output", () => {
    expect(parseIcaclsOutput("", WIN_PATH)).toEqual([]);
    expect(parseIcaclsOutput("Access is denied.", WIN_PATH)).toEqual([]);
  });
});

describe("restrictFileToOwner — POSIX", () => {
  it("chmods to 0600 and verifies the mode landed", async () => {
    const chmodCalls = [];
    const result = await restrictFileToOwner("/proj/.n-dx.json", {
      platform: "linux",
      chmodImpl: (p, mode) => chmodCalls.push([p, mode]),
      statImpl: async () => ({ mode: 0o100600 }),
    });

    expect(chmodCalls).toEqual([["/proj/.n-dx.json", OWNER_ONLY_MODE]]);
    expect(result.restricted).toBe(true);
    expect(result.method).toBe("posix-mode");
  });

  it("reports unrestricted when the filesystem ignores the mode", async () => {
    // FAT/exFAT mounts and some network shares silently drop mode changes.
    const result = await restrictFileToOwner("/mnt/usb/.n-dx.json", {
      platform: "linux",
      chmodImpl: async () => {},
      statImpl: async () => ({ mode: 0o100666 }),
    });

    expect(result.restricted).toBe(false);
    expect(result.detail).toContain("0666");
  });

  it("reports unrestricted when chmod throws", async () => {
    const result = await restrictFileToOwner("/proj/.n-dx.json", {
      platform: "linux",
      chmodImpl: async () => { throw new Error("EPERM"); },
      statImpl: async () => ({ mode: 0o100600 }),
    });

    expect(result.restricted).toBe(false);
    expect(result.detail).toContain("EPERM");
  });
});

describe("restrictFileToOwner — Windows ACL", () => {
  it("breaks inheritance, grants the current user, and verifies the DACL", async () => {
    const icacls = makeIcacls(ICACLS_RESTRICTED);

    const result = await restrictFileToOwner(WIN_PATH, {
      platform: "win32",
      execFileSyncCliImpl: icacls,
      userInfoImpl: () => ({ username: "smhal" }),
    });

    expect(icacls.calls[0].binary).toBe("icacls");
    expect(icacls.calls[0].args[0]).toBe(WIN_PATH);
    expect(icacls.calls[0].args).toContain("/inheritance:r");
    expect(icacls.calls[0].args).toContain("/grant:r");
    // Second call reads the ACL back — the verification the AC requires.
    expect(icacls.calls[1].args).toEqual([WIN_PATH]);
    expect(result.restricted).toBe(true);
    expect(result.method).toBe("windows-acl");
  });

  it("does NOT trust a zero exit code when inheritance survives", async () => {
    // icacls says "Successfully processed 1 files" here, but SYSTEM and
    // Administrators still have inherited access. Exit code alone would lie.
    const icacls = makeIcacls(ICACLS_INHERITED);

    const result = await restrictFileToOwner(WIN_PATH, {
      platform: "win32",
      execFileSyncCliImpl: icacls,
      userInfoImpl: () => ({ username: "smhal" }),
    });

    expect(result.restricted).toBe(false);
    expect(result.detail).toContain("inheritance");
    expect(result.detail).toContain("NT AUTHORITY\\SYSTEM");
  });

  it("reports unrestricted when another principal retains explicit access", async () => {
    const shared = `${WIN_PATH} HH_PC_1\\smhal:(F)
                    HH_PC_1\\otheruser:(R)

Successfully processed 1 files`;
    const icacls = makeIcacls(shared);

    const result = await restrictFileToOwner(WIN_PATH, {
      platform: "win32",
      execFileSyncCliImpl: icacls,
      userInfoImpl: () => ({ username: "smhal" }),
    });

    expect(result.restricted).toBe(false);
    expect(result.detail).toContain("otheruser");
  });

  it("matches the owner regardless of domain prefix or case", async () => {
    const icacls = makeIcacls(`${WIN_PATH} CORP\\SMHAL:(F)\n`);

    const result = await restrictFileToOwner(WIN_PATH, {
      platform: "win32",
      execFileSyncCliImpl: icacls,
      userInfoImpl: () => ({ username: "smhal" }),
    });

    expect(result.restricted).toBe(true);
  });

  it("reports unrestricted when the grant call fails", async () => {
    const icacls = makeIcacls(ICACLS_RESTRICTED, { failOn: 1 });

    const result = await restrictFileToOwner(WIN_PATH, {
      platform: "win32",
      execFileSyncCliImpl: icacls,
      userInfoImpl: () => ({ username: "smhal" }),
    });

    expect(result.restricted).toBe(false);
    expect(result.detail).toContain("icacls failed");
  });

  it("reports unrestricted when the ACL cannot be read back", async () => {
    const icacls = makeIcacls(ICACLS_RESTRICTED, { failOn: 2 });

    const result = await restrictFileToOwner(WIN_PATH, {
      platform: "win32",
      execFileSyncCliImpl: icacls,
      userInfoImpl: () => ({ username: "smhal" }),
    });

    expect(result.restricted).toBe(false);
    expect(result.detail).toContain("read back");
  });

  it("reports unrestricted when the ACL output is unparseable", async () => {
    const icacls = makeIcacls("Access is denied.");

    const result = await restrictFileToOwner(WIN_PATH, {
      platform: "win32",
      execFileSyncCliImpl: icacls,
      userInfoImpl: () => ({ username: "smhal" }),
    });

    expect(result.restricted).toBe(false);
    expect(result.detail).toContain("parse");
  });

  it("never throws — a permissions failure must not abort the preceding write", async () => {
    await expect(
      restrictFileToOwner(WIN_PATH, {
        platform: "win32",
        execFileSyncCliImpl: () => { throw new Error("boom"); },
        userInfoImpl: () => { throw new Error("no user"); },
      }),
    ).resolves.toMatchObject({ restricted: false });
  });
});

describe("describeUnrestrictedFile", () => {
  it("returns null when the file was restricted", () => {
    expect(
      describeUnrestrictedFile("/p/.n-dx.json", { restricted: true, detail: "mode 0600" }),
    ).toBeNull();
  });

  it("names the file, the cause, and the safer alternative", () => {
    const msg = describeUnrestrictedFile(
      WIN_PATH,
      { restricted: false, detail: "inheritance is still in effect" },
      "win32",
    );

    expect(msg).toContain(WIN_PATH);
    expect(msg).toContain("inheritance is still in effect");
    expect(msg).toContain("API key");
    expect(msg).toContain("Credential Manager");
  });

  it("omits the Windows-only advice on POSIX", () => {
    const msg = describeUnrestrictedFile(
      "/p/.n-dx.json",
      { restricted: false, detail: "mode is 0666" },
      "linux",
    );

    expect(msg).toContain("ANTHROPIC_API_KEY");
    expect(msg).not.toContain("Credential Manager");
  });
});
