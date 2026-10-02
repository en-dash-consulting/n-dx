/**
 * The per-user token file: created once, never rotated, and owner-only.
 *
 * The mode case is the one worth a test. Creating the file 0600 says nothing
 * about a file that already exists, so a token left at 0644 by an older n-dx,
 * an editor or a restored backup stayed world-readable for its whole life —
 * which is precisely the exposure the token exists to prevent, on a loopback
 * port every account on the host can reach.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { chmodSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { platform, tmpdir } from "node:os";
import { ensureAuthToken, hasAuthToken, readAuthToken, resolveAuthTokenPath } from "../../src/auth-token.js";

let home: string;
beforeAll(() => { home = mkdtempSync(join(tmpdir(), "ndx-auth-token-")); });
afterAll(() => { rmSync(home, { recursive: true, force: true }); });

describe("ensureAuthToken", () => {
  it("creates a token once and returns the same one afterwards", () => {
    const path = join(home, "create.token");
    expect(hasAuthToken(path)).toBe(false);
    const token = ensureAuthToken(path);
    expect(token).toMatch(/^[A-Za-z0-9_-]{32,}$/);
    // Never rotated: every server already running was started with this value.
    expect(ensureAuthToken(path)).toBe(token);
    expect(readAuthToken(path)).toBe(token);
  });

  it("creates the parent directory when the ndx home does not exist yet", () => {
    const token = ensureAuthToken(resolveAuthTokenPath({ ndxHome: join(home, "fresh", "nested") }));
    expect(token).toMatch(/^[A-Za-z0-9_-]{32,}$/);
  });

  it.skipIf(platform() === "win32")("creates the file owner-only", () => {
    const path = join(home, "modes.token");
    ensureAuthToken(path);
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it.skipIf(platform() === "win32")("tightens an existing token that others can read", () => {
    const path = join(home, "loose.token");
    writeFileSync(path, "pre-existing-token\n");
    chmodSync(path, 0o644);

    // The value survives — repairing a mode must not rotate a credential that
    // running servers are already holding.
    expect(ensureAuthToken(path)).toBe("pre-existing-token");
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it.skipIf(platform() === "win32")("leaves an already-tight token alone", () => {
    const path = join(home, "tight.token");
    writeFileSync(path, "tight-token\n", { mode: 0o600 });
    chmodSync(path, 0o400);

    // Read-only for the owner is tighter than 0600, not looser; repairing it
    // would be this function deciding something it was not asked to decide.
    expect(ensureAuthToken(path)).toBe("tight-token");
    expect(statSync(path).mode & 0o777).toBe(0o400);
  });
});
