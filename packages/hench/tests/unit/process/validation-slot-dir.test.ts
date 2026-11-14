import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  hostIdentity,
  LINUX_MACHINE_ID_FILES,
  readHostIdentity,
  resolveValidationSlotDir,
  validationSlotHostDirname,
  type HostIdentity,
  type HostIdentitySources,
} from "../../../src/process/validation-slot-dir.js";
import { VALIDATION_SLOT_DIRNAME } from "../../../src/process/validation-slot.js";

const LINUX_ID = "0123456789abcdef0123456789abcdef";
const MAC_UUID = "7A1B2C3D-4E5F-6071-8293-A4B5C6D7E8F9";
const WIN_GUID = "a1b2c3d4-e5f6-4789-abcd-ef0123456789";

const IOREG_OUTPUT = `+-o J316sAP  <class IOPlatformExpertDevice, id 0x100000226, registered, matched, active, busy 0 (2 ms), retain 39>
    {
      "IOPlatformSerialNumber" = "C02XXXXXXX"
      "IOPlatformUUID" = "${MAC_UUID}"
      "model" = <"MacBookPro18,1">
    }
`;

const REG_OUTPUT = `
HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography
    MachineGuid    REG_SZ    ${WIN_GUID}

`;

/** Sources where nothing is readable unless a case supplies it. */
function sources(overrides: Partial<HostIdentitySources>): HostIdentitySources & { runs: string[][] } {
  const runs: string[][] = [];
  return {
    platform: "linux",
    readFile: async (path) => {
      throw Object.assign(new Error(`ENOENT: ${path}`), { code: "ENOENT" });
    },
    run: async () => undefined,
    hostname: () => "Ryans-MBP.local",
    ...overrides,
    runs,
  };
}

function recordingRun(stdout: string | undefined, runs: string[][]): HostIdentitySources["run"] {
  return async (file, args) => {
    runs.push([file, ...args]);
    return stdout;
  };
}

describe("readHostIdentity", () => {
  it("reads /etc/machine-id on Linux", async () => {
    const src = sources({ readFile: async (path) => (path === "/etc/machine-id" ? `${LINUX_ID}\n` : "") });
    expect(await readHostIdentity(src)).toEqual({ kind: "machine", id: LINUX_ID });
  });

  it("falls back to /var/lib/dbus/machine-id when /etc/machine-id is missing or unset", async () => {
    for (const etc of [undefined, "", "uninitialized\n"]) {
      const src = sources({
        readFile: async (path) => {
          if (path === LINUX_MACHINE_ID_FILES[1]) return LINUX_ID;
          if (etc === undefined) throw new Error("ENOENT");
          return etc;
        },
      });
      expect(await readHostIdentity(src)).toEqual({ kind: "machine", id: LINUX_ID });
    }
  });

  it("reads IOPlatformUUID from ioreg on macOS, without a shell", async () => {
    const src = sources({ platform: "darwin" });
    src.run = recordingRun(IOREG_OUTPUT, src.runs);
    expect(await readHostIdentity(src)).toEqual({ kind: "machine", id: MAC_UUID });
    expect(src.runs).toEqual([["ioreg", "-rd1", "-c", "IOPlatformExpertDevice"]]);
  });

  it("reads MachineGuid from the registry on Windows", async () => {
    const src = sources({ platform: "win32" });
    src.run = recordingRun(REG_OUTPUT, src.runs);
    expect(await readHostIdentity(src)).toEqual({ kind: "machine", id: WIN_GUID });
    expect(src.runs).toEqual([["reg", "query", "HKLM\\SOFTWARE\\Microsoft\\Cryptography", "/v", "MachineGuid"]]);
  });

  it("falls back to the hostname when no machine id can be read", async () => {
    const cases: HostIdentitySources[] = [
      sources({ platform: "linux" }),
      sources({ platform: "darwin" }), // ioreg failed or timed out
      sources({ platform: "darwin", run: async () => "no uuid here" }),
      sources({ platform: "win32" }),
      sources({ platform: "freebsd" }),
    ];
    for (const src of cases) {
      expect(await readHostIdentity(src)).toEqual({ kind: "hostname", id: "Ryans-MBP.local" });
    }
  });
});

describe("hostIdentity", () => {
  it("reads once per process", async () => {
    const first = hostIdentity();
    expect(hostIdentity()).toBe(first);
    expect((await first).id).not.toBe("");
  });
});

describe("validationSlotHostDirname", () => {
  it("is m- or h- and 16 hex characters, never the raw id", () => {
    const machine = validationSlotHostDirname({ kind: "machine", id: MAC_UUID });
    const host = validationSlotHostDirname({ kind: "hostname", id: "Ryans-MBP.local" });
    expect(machine).toMatch(/^m-[0-9a-f]{16}$/);
    expect(host).toMatch(/^h-[0-9a-f]{16}$/);
    for (const name of [machine, host]) {
      expect(name.toLowerCase()).not.toContain(MAC_UUID.toLowerCase().slice(0, 8));
      expect(name.toLowerCase()).not.toContain("ryans");
    }
  });

  it("ignores case and surrounding whitespace, and keeps a machine apart from a hostname with the same text", () => {
    expect(validationSlotHostDirname({ kind: "machine", id: ` ${MAC_UUID.toLowerCase()}\n` })).toBe(
      validationSlotHostDirname({ kind: "machine", id: MAC_UUID }),
    );
    expect(validationSlotHostDirname({ kind: "hostname", id: MAC_UUID })).not.toBe(
      validationSlotHostDirname({ kind: "machine", id: MAC_UUID }),
    );
  });

  it("names an empty hostname inside the slot root, never the root or its parent", () => {
    expect(validationSlotHostDirname({ kind: "hostname", id: "" })).toMatch(/^h-[0-9a-f]{16}$/);
  });
});

describe("resolveValidationSlotDir", () => {
  const home = join(tmpdir(), "ndx-home");

  it("is the host directory under validation-slot in the ndx home the environment names", async () => {
    const identity: HostIdentity = { kind: "machine", id: LINUX_ID };
    expect(await resolveValidationSlotDir({ NDX_HOME: home }, identity)).toBe(
      join(home, VALIDATION_SLOT_DIRNAME, validationSlotHostDirname(identity)),
    );
    expect(await resolveValidationSlotDir({ NDX_HOME: home })).toBe(
      join(home, VALIDATION_SLOT_DIRNAME, validationSlotHostDirname(await hostIdentity())),
    );
  });

  it("agrees across a hostname change when the machine id is the same", async () => {
    const before = sources({ platform: "darwin", run: async () => IOREG_OUTPUT, hostname: () => "ryans-mbp.local" });
    const after = sources({ platform: "darwin", run: async () => IOREG_OUTPUT, hostname: () => "ryans-mbp.lan" });
    expect(await resolveValidationSlotDir({ NDX_HOME: home }, await readHostIdentity(before))).toBe(
      await resolveValidationSlotDir({ NDX_HOME: home }, await readHostIdentity(after)),
    );
  });

  it("gives machines sharing one ndx home separate directories", async () => {
    expect(await resolveValidationSlotDir({ NDX_HOME: home }, { kind: "machine", id: LINUX_ID })).not.toBe(
      await resolveValidationSlotDir({ NDX_HOME: home }, { kind: "machine", id: WIN_GUID }),
    );
  });
});
