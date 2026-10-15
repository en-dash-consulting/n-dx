/**
 * Release verify step — decides from the changesets `published` output and
 * waits for npm instead of treating a 404 right after publish as "nothing to do".
 * Every lookup and the sleep are injected: nothing spawns, nothing really waits.
 *
 * @see scripts/verify-release-sync.mjs
 */
import { describe, it, expect } from "vitest";
import { verifyReleaseSync, parsePublished,DEFAULT_DELAYS_MS, MAX_TOTAL_WAIT_MS } from "../../scripts/verify-release-sync.mjs";

const PACKAGES = ["core", "rex", "sourcevision", "hench", "llm-client", "web"];

function harness({ published = true, npmVisibleAfter = 0, tags = true, releases = true, delaysMs = [1, 2, 3] } = {}) {
  const logs = [];
  const sleeps = [];
  const npmCalls = [];
  let polls = 0;
  const run = () =>
    verifyReleaseSync({
      published,
      packages: PACKAGES,
      versionOf: () => "1.2.3",
      npmHas: (spec) => {
        npmCalls.push(spec);
        if (spec.startsWith("@n-dx/core@")) polls++;
        return polls > npmVisibleAfter;
      },
      hasTag: () => tags,
      hasRelease: () => releases,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      log: (l) => logs.push(l),
      delaysMs,
    });
  return { run, logs, sleeps, npmCalls };
}

describe("verifyReleaseSync", () => {
  it("exits 0 without any lookup when the run did not publish", async () => {
    const h = harness({ published: false });
    expect(await h.run()).toBe(0);
    expect(h.npmCalls).toEqual([]);
    expect(h.sleeps).toEqual([]);
    expect(h.logs.join("\n")).toContain("nothing to verify");
  });

  it("checks every package on npm", async () => {
    const h = harness();
    expect(await h.run()).toBe(0);
    expect(h.npmCalls).toEqual(PACKAGES.map((p) => `@n-dx/${p}@1.2.3`));
  });

  it("retries with the given backoff until the version appears, then checks tags and releases", async () => {
    const h = harness({ npmVisibleAfter: 2 });
    expect(await h.run()).toBe(0);
    expect(h.sleeps).toEqual([1, 2]);
    expect(h.logs.filter((l) => l.startsWith("✓ tag"))).toHaveLength(6);
    expect(h.logs.filter((l) => l.startsWith("✓ release"))).toHaveLength(6);
  });

  it("fails with a clear error when the version never appears within the bound", async () => {
    const h = harness({ npmVisibleAfter: Infinity });
    expect(await h.run()).toBe(1);
    expect(h.sleeps).toEqual([1, 2, 3]);
    expect(h.logs.join("\n")).toContain("never appeared on npm");
  });

  it("keeps the default wait inside the release job's timeout budget", () => {
    const total = DEFAULT_DELAYS_MS.reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(0);
    expect(total).toBeLessThanOrEqual(MAX_TOTAL_WAIT_MS);
  });

  it("fails when a tag or release is missing once npm has the version", async () => {
    expect(await harness({ tags: false }).run()).toBe(1);
    const h = harness({ releases: false });
    expect(await h.run()).toBe(1);
    expect(h.logs.join("\n")).toContain("missing GitHub release @n-dx/core@1.2.3");
  });
});

describe("parsePublished", () => {
  it("accepts only the strings the changesets action sets", () => {
    expect(parsePublished("true")).toBe(true);
    expect(parsePublished("false")).toBe(false);
  });

  it.each([undefined, "", "TRUE", "1", "null"])("rejects %j so main() exits 2 instead of skipping", (raw) => {
    expect(parsePublished(raw)).toBeNull();
  });
});
