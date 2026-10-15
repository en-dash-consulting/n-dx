#!/usr/bin/env node
/**
 * Release verify step: after a publish, every package must be on npm, tagged on
 * origin, and have a GitHub release. See RELEASING.md, "Automated releases".
 *
 * Whether this run published comes from the changesets action's `published`
 * output (PUBLISHED env), never from an npm lookup: the registry can take
 * minutes to show a fresh version, and "not visible yet" must not read as
 * "nothing was published". When the run did publish, the npm lookup is retried
 * with backoff for a bounded time and a version that never appears fails.
 *
 * Env: PUBLISHED ("true"/"false"), PACKAGES (space-separated short names),
 *      GH_TOKEN (for gh).
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const SCOPE = "@n-dx";
/** Backoff between npm lookups: 10s, 20s, 40s, then 60s — about 25 minutes in all. */
export const DEFAULT_DELAYS_MS = [10, 20, 40, ...Array(22).fill(60)].map((s) => s * 1000);

/**
 * @param {object} o
 * @param {boolean} o.published  changesets action `published` output
 * @param {string[]} o.packages  short package names
 * @param {(pkg: string) => string} o.versionOf
 * @param {(spec: string) => boolean | Promise<boolean>} o.npmHas
 * @param {(tag: string) => boolean | Promise<boolean>} o.hasTag
 * @param {(tag: string) => boolean | Promise<boolean>} o.hasRelease
 * @param {(ms: number) => Promise<void>} o.sleep
 * @param {(line: string) => void} [o.log]
 * @param {number[]} [o.delaysMs]
 * @returns {Promise<number>} process exit code
 */
export async function verifyReleaseSync(o) {
  const log = o.log ?? console.log;
  const delays = o.delaysMs ?? DEFAULT_DELAYS_MS;
  const entries = o.packages.map((pkg) => {
    const version = o.versionOf(pkg);
    return { version, tag: `${SCOPE}/${pkg}@${version}` };
  });

  if (!o.published) {
    log(`${entries[0].tag} was not published by this run; nothing to verify.`);
    return 0;
  }

  let pending = entries;
  for (let attempt = 0; ; attempt++) {
    const still = [];
    for (const e of pending) {
      if (await o.npmHas(e.tag)) log(`✓ npm ${e.tag}`);
      else still.push(e);
    }
    pending = still;
    if (pending.length === 0) break;
    if (attempt >= delays.length) {
      for (const e of pending) log(`::error::${e.tag} was published by this run but never appeared on npm`);
      log("::error::npm did not show the published versions within the wait bound — see RELEASING.md");
      return 1;
    }
    log(`Waiting ${delays[attempt] / 1000}s for npm: ${pending.map((e) => e.tag).join(", ")}`);
    await o.sleep(delays[attempt]);
  }

  let failed = false;
  for (const e of entries) {
    if (await o.hasTag(e.tag)) log(`✓ tag ${e.tag}`);
    else {
      log(`::error::missing git tag ${e.tag} on origin`);
      failed = true;
    }
    if (await o.hasRelease(e.tag)) log(`✓ release ${e.tag}`);
    else {
      log(`::error::missing GitHub release ${e.tag}`);
      failed = true;
    }
  }
  if (failed) {
    log("::error::npm has the published versions but GitHub is out of sync — see RELEASING.md, 'Backfilling missing tags and releases'");
    return 1;
  }
  log(`All ${entries[0].version} tags and releases present.`);
  return 0;
}

function succeeds(cmd, args) {
  try {
    execFileSync(cmd, args, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const packages = (process.env.PACKAGES ?? "").split(/\s+/).filter(Boolean);
  if (packages.length === 0) {
    console.error("::error::PACKAGES is empty");
    return 2;
  }
  return verifyReleaseSync({
    published: process.env.PUBLISHED === "true",
    packages,
    versionOf: (pkg) => JSON.parse(readFileSync(`packages/${pkg}/package.json`, "utf8")).version,
    npmHas: (spec) => succeeds("npm", ["view", spec, "version"]),
    hasTag: (tag) => succeeds("git", ["ls-remote", "--exit-code", "--tags", "origin", `refs/tags/${tag}`]),
    hasRelease: (tag) => succeeds("gh", ["release", "view", tag]),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exit(await main());
}
