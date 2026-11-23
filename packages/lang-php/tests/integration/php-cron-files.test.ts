import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { findCrontabFiles } from "../../src/index.js";

describe("findCrontabFiles", () => {
  let root: string | undefined;
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it("searches two levels below the root, cron.d one more, and the listed files; never vendor/ or hidden directories", async () => {
    root = mkdtempSync(join(tmpdir(), "php-cron-"));
    for (const file of ["crontab", "deploy/app.cron", "a/b/crontab", "etc/x/cron.d/job", "a/b/c/crontab", "vendor/crontab", ".git/crontab", "deep/1/2/3/crontab"]) {
      mkdirSync(join(root, dirname(file)), { recursive: true });
      writeFileSync(join(root, file), "");
    }
    expect(await findCrontabFiles(root, ["deep/1/2/3/crontab", "deep/1/2/3/x.php"])).toEqual([
      "a/b/crontab",
      "crontab",
      "deep/1/2/3/crontab",
      "deploy/app.cron",
      "etc/x/cron.d/job",
    ]);
  });
});
