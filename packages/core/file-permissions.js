/**
 * Owner-only file permissions, cross-OS.
 *
 * `.n-dx.json` can hold provider API keys, so it must not be readable by other
 * users of the machine. POSIX expresses that as mode 0600. Windows has no such
 * mode: `fs.chmod` there maps only the read-only attribute and makes NO change
 * to the file's DACL. Measured on Windows 11 — after `chmod(path, 0o600)`:
 *
 *   mode reads back as 0666 (not 0600)
 *   icacls shows  SYSTEM:(I)(F)  Administrators:(I)(F)  <user>:(I)(F)
 *
 * Every entry is `(I)` — inherited. The 0600 request had no effect on who could
 * read the key. The Windows equivalent is to break inheritance and grant the
 * current user alone, via `icacls /inheritance:r /grant:r`.
 *
 * This module always VERIFIES the result rather than trusting an exit code, and
 * reports what it actually achieved. Callers must surface an unrestricted result
 * instead of assuming success — claiming a protection that is not in place is
 * worse than stating the limitation.
 *
 * @module core/file-permissions
 */

import { chmod as fsChmod, stat as fsStat } from "node:fs/promises";
import { userInfo as osUserInfo } from "node:os";
import { execFileSyncCli } from "./win-spawn.js";

/** POSIX mode for owner read/write only. */
export const OWNER_ONLY_MODE = 0o600;

/**
 * Parse `icacls <path>` output into access-control entries.
 *
 * The first line carries the path followed by the first ACE; later ACEs sit on
 * their own indented lines. Identities and flag letters are symbolic and not
 * localized (`(I)` for inherited, `(F)` for full control), so parsing them is
 * locale-safe — unlike the trailing "Successfully processed N files" summary,
 * which is translated and deliberately ignored here.
 *
 * @param {string} output Raw icacls stdout.
 * @param {string} path The path passed to icacls, stripped from the first line.
 * @returns {Array<{ identity: string, flags: string[] }>}
 */
export function parseIcaclsOutput(output, path) {
  const aces = [];

  for (const rawLine of String(output).split(/\r?\n/)) {
    // Drop the echoed path so the first ACE parses like any other.
    const line = rawLine.replace(path, "").trim();
    if (!line) continue;

    // identity:(FLAG)(FLAG)... — identities contain spaces and backslashes
    // ("NT AUTHORITY\SYSTEM"), so match the flag groups from the right.
    const match = line.match(/^(.*?):((?:\([^)]*\))+)$/);
    if (!match) continue;

    const identity = match[1].trim();
    if (!identity) continue;

    const flags = [...match[2].matchAll(/\(([^)]*)\)/g)].map((m) => m[1]);
    aces.push({ identity, flags });
  }

  return aces;
}

/** Compare two Windows identities, ignoring case and any domain prefix. */
function sameIdentity(a, b) {
  const bare = (s) => String(s).toLowerCase().split("\\").pop().trim();
  return bare(a) === bare(b);
}

/**
 * Restrict `path` so only its owner can read it.
 *
 * Never throws: a permissions failure must not abort the write that preceded it.
 * The caller decides how loudly to report an unrestricted result.
 *
 * The platform and every OS call are injectable so both branches are testable on
 * any host — CI runs the suite on Linux only, so the Windows path would
 * otherwise ship unexercised.
 *
 * @param {string} path
 * @param {object} [options]
 * @param {NodeJS.Platform} [options.platform]
 * @param {Function} [options.chmodImpl]
 * @param {Function} [options.statImpl]
 * @param {Function} [options.execFileSyncCliImpl]
 * @param {Function} [options.userInfoImpl]
 * @returns {Promise<{ restricted: boolean, method: "posix-mode"|"windows-acl", detail: string }>}
 */
export async function restrictFileToOwner(path, {
  platform = process.platform,
  chmodImpl = fsChmod,
  statImpl = fsStat,
  execFileSyncCliImpl = execFileSyncCli,
  userInfoImpl = osUserInfo,
} = {}) {
  return platform === "win32"
    ? restrictViaAcl(path, { execFileSyncCliImpl, userInfoImpl })
    : restrictViaPosixMode(path, { chmodImpl, statImpl });
}

async function restrictViaPosixMode(path, { chmodImpl, statImpl }) {
  try {
    await chmodImpl(path, OWNER_ONLY_MODE);
  } catch (err) {
    return {
      restricted: false,
      method: "posix-mode",
      detail: `chmod failed: ${err?.message ?? err}`,
    };
  }

  // Verify rather than assume: some filesystems (FAT/exFAT mounts, certain
  // network shares) silently ignore mode changes.
  try {
    const { mode } = await statImpl(path);
    const actual = mode & 0o777;
    if (actual !== OWNER_ONLY_MODE) {
      return {
        restricted: false,
        method: "posix-mode",
        detail: `mode is 0${actual.toString(8)}, expected 0600 — the filesystem may not support POSIX permissions`,
      };
    }
  } catch (err) {
    return {
      restricted: false,
      method: "posix-mode",
      detail: `could not verify mode: ${err?.message ?? err}`,
    };
  }

  return { restricted: true, method: "posix-mode", detail: "mode 0600" };
}

async function restrictViaAcl(path, { execFileSyncCliImpl, userInfoImpl }) {
  let username;
  try {
    username = userInfoImpl().username;
  } catch (err) {
    return {
      restricted: false,
      method: "windows-acl",
      detail: `could not determine the current user: ${err?.message ?? err}`,
    };
  }

  // Fully qualify when the domain is known: a bare name can be ambiguous
  // between a local and a domain account.
  const domain = process.env.USERDOMAIN;
  const grantee = domain ? `${domain}\\${username}` : username;

  // Routed through win-spawn.js: the path may contain spaces or cmd.exe
  // metacharacters, and repo policy bans hand-built Windows command lines.
  try {
    execFileSyncCliImpl(
      "icacls",
      [path, "/inheritance:r", "/grant:r", `${grantee}:F`],
      { stdio: "ignore" },
    );
  } catch (err) {
    return {
      restricted: false,
      method: "windows-acl",
      detail: `icacls failed: ${err?.message ?? err}`,
    };
  }

  // Verify the DACL rather than trusting the exit code — icacls reports
  // "Successfully processed 1 files" in cases where the ACL is not what we asked
  // for, and it can partially succeed.
  let output;
  try {
    output = execFileSyncCliImpl("icacls", [path], { encoding: "utf-8" });
  } catch (err) {
    return {
      restricted: false,
      method: "windows-acl",
      detail: `could not read back the ACL: ${err?.message ?? err}`,
    };
  }

  let aces = parseIcaclsOutput(output, path);

  // `/inheritance:r` strips inherited ACEs and `/grant:r` replaces the
  // user's own grants — but neither touches EXPLICIT ACEs other principals
  // already hold. Files created under some directories start with explicit
  // (non-inherited) ACEs for SYSTEM and Administrators (GitHub-hosted
  // Windows runners' %TEMP% is one), so the grant alone leaves the key
  // readable by them. Remove each leftover explicitly, then re-verify.
  // The user's own grant is already in place, so removal cannot lock us out.
  const leftoverExplicit = [...new Set(
    aces
      .filter((ace) => !ace.flags.includes("I") && !sameIdentity(ace.identity, username))
      .map((ace) => ace.identity),
  )];
  if (leftoverExplicit.length > 0) {
    try {
      execFileSyncCliImpl(
        "icacls",
        [path, ...leftoverExplicit.flatMap((identity) => ["/remove", identity])],
        { stdio: "ignore" },
      );
      output = execFileSyncCliImpl("icacls", [path], { encoding: "utf-8" });
      aces = parseIcaclsOutput(output, path);
    } catch (err) {
      return {
        restricted: false,
        method: "windows-acl",
        detail: `icacls failed removing ${leftoverExplicit.join(", ")}: ${err?.message ?? err}`,
      };
    }
  }

  if (aces.length === 0) {
    return {
      restricted: false,
      method: "windows-acl",
      detail: "could not parse the ACL from icacls output",
    };
  }

  const inherited = aces.filter((ace) => ace.flags.includes("I"));
  if (inherited.length > 0) {
    return {
      restricted: false,
      method: "windows-acl",
      detail: `inheritance is still in effect (${inherited.map((a) => a.identity).join(", ")})`,
    };
  }

  const foreign = aces.filter((ace) => !sameIdentity(ace.identity, username));
  if (foreign.length > 0) {
    return {
      restricted: false,
      method: "windows-acl",
      detail: `other principals still have access: ${foreign.map((a) => a.identity).join(", ")}`,
    };
  }

  return {
    restricted: true,
    method: "windows-acl",
    detail: `DACL restricted to ${grantee}`,
  };
}

/**
 * Human-readable warning for a failed restriction, or null when it succeeded.
 *
 * Kept here so every caller words the limitation the same way.
 *
 * @param {string} path
 * @param {{ restricted: boolean, detail: string }} result
 * @param {NodeJS.Platform} [platform]
 * @returns {string | null}
 */
export function describeUnrestrictedFile(path, result, platform = process.platform) {
  if (result.restricted) return null;

  const alternative = platform === "win32"
    ? "Prefer the ANTHROPIC_API_KEY environment variable, or Windows Credential Manager."
    : "Prefer the ANTHROPIC_API_KEY environment variable.";

  return (
    `Warning: could not restrict permissions on ${path}\n` +
    `  ${result.detail}\n` +
    `  The file contains an API key and may be readable by other users of this machine.\n` +
    `  ${alternative}`
  );
}
