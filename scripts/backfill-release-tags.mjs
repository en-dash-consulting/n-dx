#!/usr/bin/env node
/**
 * Backfill git tags and GitHub releases for versions that reached npm without them.
 *
 * Background: 0.5.0–0.7.0 were published to npm while the Release workflow ran
 * changesets/action@v1 against @changesets/cli v3. v1 discovered published
 * packages by scraping `New tag:` lines from stdout; CLI v3 stopped printing
 * them, so the action pushed no tags and created no releases — and stayed
 * green. See RELEASING.md, "Backfilling missing tags and releases".
 *
 * What this does, for every (version, commit) in VERSIONS × PACKAGES:
 *   1. asserts packages/<pkg>/package.json at <commit> has that version
 *   2. extracts the `## <version>` section of packages/<pkg>/CHANGELOG.md at <commit>
 *   3. creates an annotated tag `@n-dx/<pkg>@<version>` at <commit> and pushes it
 *      (unless origin already has it)
 *   4. creates a GitHub release of the same name with that CHANGELOG section as
 *      the body (unless one already exists)
 *
 * This mirrors what changesets/action@v2 does after a publish: tag name ==
 * release name == `<packageName>@<version>`, body == CHANGELOG entry,
 * prerelease when the version contains "-".
 *
 * Idempotent — existing tags and releases are skipped, so re-running is safe.
 *
 * Usage:
 *   node scripts/backfill-release-tags.mjs             # dry run (default)
 *   node scripts/backfill-release-tags.mjs --execute   # push tags, create releases
 *
 * Requires: git with push access to origin, and `gh` authenticated for the repo.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** version → "chore: version packages" merge commit on main. Ascending order matters:
 *  GitHub marks the most recently created non-prerelease release "Latest". */
const VERSIONS = [
  ["0.5.0", "a80d4ef7"], // #296
  ["0.5.1", "cf13a6b3"], // #338
  ["0.5.2", "c1a6cc81"], // #349
  ["0.6.0", "1616ccb0"], // #355
  ["0.7.0", "93814130"], // #373
];

const SCOPE = "@n-dx";
const PACKAGES = ["core", "rex", "sourcevision", "hench", "llm-client", "web"];

const execute = process.argv.includes("--execute");
if (process.argv.some((a) => a.startsWith("-") && a !== "--execute" && a !== "--dry-run")) {
  console.error("Unknown flag. Usage: node scripts/backfill-release-tags.mjs [--execute]");
  process.exit(2);
}

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts });
}

function tryRun(cmd, args) {
  try {
    return run(cmd, args);
  } catch {
    return null;
  }
}

const repoRoot = run("git", ["rev-parse", "--show-toplevel"]).trim();
process.chdir(repoRoot);

if (execute && tryRun("gh", ["auth", "status"]) === null) {
  console.error("gh is not authenticated — run `gh auth login` first.");
  process.exit(1);
}

/** Tags already on origin (peeled `^{}` entries dropped). */
const remoteTags = new Set(
  run("git", ["ls-remote", "--tags", "origin"])
    .split("\n")
    .map((l) => l.split("\t")[1])
    .filter((r) => r && !r.endsWith("^{}"))
    .map((r) => r.replace(/^refs\/tags\//, "")),
);

/** Existing GitHub releases by tag name. */
const releases = new Set(
  JSON.parse(run("gh", ["release", "list", "--limit", "1000", "--json", "tagName"])).map((r) => r.tagName),
);

const localTags = new Set(run("git", ["tag", "--list"]).split("\n").filter(Boolean));

/**
 * Return the body of the `## <version>` section: everything after the heading
 * line up to the next `## ` heading (or EOF), trimmed. Fenced code blocks are
 * skipped so a `## ` inside one cannot end the section early — matching
 * changesets/action's getChangelogEntry.
 */
function changelogEntry(changelog, version) {
  const lines = changelog.split("\n");
  let start = -1;
  let inFence = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = /^(`{3,})/.exec(line);
    if (fence) {
      if (inFence === null) inFence = fence[1];
      else if (line.startsWith(inFence)) inFence = null;
      continue;
    }
    if (inFence !== null) continue;
    if (start === -1) {
      if (line.trim() === `## ${version}`) start = i + 1;
    } else if (/^## /.test(line)) {
      return lines.slice(start, i).join("\n").trim();
    }
  }
  return start === -1 ? null : lines.slice(start).join("\n").trim();
}

let created = { tags: 0, releases: 0 };
let skipped = { tags: 0, releases: 0 };
const newestVersion = VERSIONS[VERSIONS.length - 1][0];
const tmp = mkdtempSync(join(tmpdir(), "backfill-release-"));

try {
  for (const [version, shortSha] of VERSIONS) {
    const commit = run("git", ["rev-parse", "--verify", `${shortSha}^{commit}`]).trim();
    console.log(`\n== ${version} @ ${commit.slice(0, 8)} ==`);

    // Validate every package first so a bad row aborts before any push.
    const entries = PACKAGES.map((pkg) => {
      const pkgJson = JSON.parse(run("git", ["show", `${commit}:packages/${pkg}/package.json`]));
      if (pkgJson.version !== version) {
        throw new Error(`packages/${pkg}/package.json at ${shortSha} is ${pkgJson.version}, expected ${version}`);
      }
      const changelog = run("git", ["show", `${commit}:packages/${pkg}/CHANGELOG.md`]);
      const body = changelogEntry(changelog, version);
      if (body === null) {
        throw new Error(`No "## ${version}" section in packages/${pkg}/CHANGELOG.md at ${shortSha}`);
      }
      return { pkg, tag: `${SCOPE}/${pkg}@${version}`, body };
    });

    // Tags: create locally where missing, then push the batch for this version.
    const toPush = [];
    for (const { tag } of entries) {
      if (remoteTags.has(tag)) {
        console.log(`  skip tag      ${tag} (already on origin)`);
        skipped.tags++;
        continue;
      }
      if (!localTags.has(tag)) {
        console.log(`  ${execute ? "create" : "would create"} tag ${tag} -> ${commit.slice(0, 8)}`);
        if (execute) run("git", ["tag", "-a", tag, "-m", tag, commit]);
      } else {
        console.log(`  local tag exists ${tag}; will push`);
      }
      toPush.push(tag);
    }
    if (toPush.length) {
      console.log(`  ${execute ? "push" : "would push"} ${toPush.length} tag(s) to origin`);
      if (execute) run("git", ["push", "origin", ...toPush.map((t) => `refs/tags/${t}`)]);
      created.tags += toPush.length;
    }

    // Releases.
    for (const { tag, body } of entries) {
      if (releases.has(tag)) {
        console.log(`  skip release  ${tag} (already exists)`);
        skipped.releases++;
        continue;
      }
      const args = ["release", "create", tag, "--title", tag, "--verify-tag"];
      if (version.includes("-")) args.push("--prerelease");
      // Older versions must not steal the "Latest" badge from the newest one.
      if (version !== newestVersion) args.push("--latest=false");
      console.log(`  ${execute ? "create" : "would create"} release ${tag} (${body.split("\n").length} body lines)`);
      if (execute) {
        const notes = join(tmp, `${tag.replace(/[@/]/g, "_")}.md`);
        writeFileSync(notes, body + "\n");
        run("gh", [...args, "--notes-file", notes]);
      }
      created.releases++;
    }
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log(
  `\n${execute ? "Done." : "Dry run."} tags: ${created.tags} ${execute ? "pushed" : "to push"}, ${skipped.tags} skipped; ` +
    `releases: ${created.releases} ${execute ? "created" : "to create"}, ${skipped.releases} skipped.` +
    (execute ? "" : "\nRe-run with --execute to apply."),
);
