/** Release validation must gate publishing and cover every suite. */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "../..");
const workflow = readFileSync(join(ROOT, ".github/workflows/release.yml"), "utf8").replace(/\r\n/g, "\n");
const jobs = Object.fromEntries(
  [...workflow.matchAll(/^  ([\w-]+):\n((?:(?!^  [\w-]+:)[\s\S])*)/gm)]
    .filter(([, , body]) => /^    runs-on:/m.test(body))
    .map(([, name, body]) => [name, body]),
);

describe("release validation", () => {
  it("runs every workspace test suite and root exactly once across the matrix", () => {
    const suites = [...jobs.validate.matchAll(/^ {12}suites: (.+)$/gm)]
      .flatMap(([, labels]) => labels.split(","));
    const expected = ["root", ...readdirSync(join(ROOT, "packages")).filter((dir) => {
      const path = join(ROOT, "packages", dir, "package.json");
      return existsSync(path) && JSON.parse(readFileSync(path, "utf8")).scripts?.test;
    })];
    expect(suites.sort()).toEqual(expected.sort());
    expect(jobs.validate).toMatch(/^      fail-fast: false$/m);
    expect(jobs.validate).toContain("run: node scripts/run-all-tests.mjs ${{ matrix.suites }}");
    expect(jobs.validate).not.toContain("pnpm -r run test");
  });

  it("requires successful validation before publishing, without a status bypass", () => {
    expect(jobs.release).toMatch(/^    needs: validate$/m);
    // GitHub applies the default success() check to this event-only condition.
    expect(jobs.release).toMatch(/^    if: github.event_name == 'push' \|\| inputs.mode == 'publish'$/m);
    for (const job of [jobs.release, jobs.validate]) {
      expect(job).not.toMatch(/always\(|!cancelled\(|continue-on-error:/);
    }
    expect(jobs.release).toContain("uses: changesets/action@");
    expect(jobs.release).not.toMatch(/run-all-tests|run test/);
  });

  it("keeps validation read-only and publishing credentials in the publisher", () => {
    expect(jobs.validate).toMatch(/^    permissions:\n      contents: read\n/m);
    expect(jobs.validate).not.toMatch(/environment:|id-token:|: write/);
    expect(jobs.release).toMatch(/^    environment: npm$/m);
    expect(jobs.release).toMatch(/^      id-token: write$/m);
    expect(jobs.release).toContain("run: pnpm build");
    expect(jobs.release).toContain("run: pnpm -r --workspace-concurrency=1 run build:grammars");
    expect(jobs.release).toContain("run: node scripts/verify-release-sync.mjs");
  });

  it("runs the OIDC probe independently when validation and publishing are skipped", () => {
    expect(jobs.validate).toMatch(/^    if: github.event_name == 'push' \|\| inputs.mode == 'publish'$/m);
    const probe = jobs["validate-oidc"];
    expect(probe).toMatch(/^    if: github.event_name == 'workflow_dispatch' && inputs.mode == 'validate-oidc'$/m);
    expect(probe).not.toMatch(/^    needs:/m);
    expect(probe).toMatch(/^    environment: npm$/m);
    expect(probe).toMatch(/^      id-token: write$/m);
    expect(probe).toContain("/-/npm/v1/oidc/token/exchange/package/");
    expect(probe).not.toContain("uses: changesets/action@");
  });
});
