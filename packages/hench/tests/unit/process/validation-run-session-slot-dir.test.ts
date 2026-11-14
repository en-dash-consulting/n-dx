/**
 * `withSessionValidationSlotDir`: the vendor CLI session's slot directory,
 * waited for (bounded and abortable) rather than peeked. The spawn-site cases
 * (slow lookup, abort, transient failure, Codex) are in
 * `tests/unit/guard/sandbox-pre-spawn.test.ts`.
 */
import { describe, it, expect, vi } from "vitest";
import { join } from "node:path";
import { withSessionValidationSlotDir } from "../../../src/process/validation-run.js";
import { VALIDATION_SLOT_DIR_ENV, VALIDATION_SLOT_DIRNAME } from "../../../src/process/validation-slot.js";
import { validationSlotHostDirname, type HostIdentity } from "../../../src/process/validation-slot-dir.js";

const IDENTITY: HostIdentity = { kind: "machine", id: "0123456789abcdef0123456789abcdef" };
const home = join("/", "ndx-home");
const hostEnv = { NDX_HOME: home };
const pending = Object.assign(() => new Promise<HostIdentity>(() => {}), { peek: () => undefined });

describe("withSessionValidationSlotDir", () => {
  it("adds the host-resolved directory, and no token, once the lookup resolves", async () => {
    const cache = Object.assign(async () => IDENTITY, { peek: () => undefined });
    expect(await withSessionValidationSlotDir({ PATH: "/bin" }, { hostEnv, cache })).toEqual({
      PATH: "/bin",
      [VALIDATION_SLOT_DIR_ENV]: join(home, VALIDATION_SLOT_DIRNAME, validationSlotHostDirname(IDENTITY)),
    });
  });

  it("keeps a directory the session was already given, without a lookup", async () => {
    const base = { [VALIDATION_SLOT_DIR_ENV]: join(home, "holder-slot") };
    expect(await withSessionValidationSlotDir(base, { hostEnv, cache: pending })).toBe(base);
  });

  it("stops waiting at its limit, and warns once", async () => {
    const warn = vi.fn();
    const base = { PATH: "/bin" };
    expect(await withSessionValidationSlotDir(base, { hostEnv, cache: pending, timeoutMs: 10, warn })).toBe(base);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toContain("this host's identity was not read within");
  });

  it("returns at once, without warning, when the run is already aborted", async () => {
    const warn = vi.fn();
    const base = { PATH: "/bin" };
    expect(await withSessionValidationSlotDir(base, { hostEnv, cache: pending, signal: AbortSignal.abort(), warn })).toBe(base);
    expect(warn).not.toHaveBeenCalled();
  });
});
