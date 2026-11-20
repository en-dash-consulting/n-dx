/**
 * A legacy PHP site whose document root is a prefixed `htdocs` nested under
 * the application (`site/main/default_htdocs/`), with no `index.php` at the
 * repository root: the layout of a real estate whose routes never reached
 * components.json, because only a docroot named exactly `htdocs`, `public`
 * and so on was recognised. `sv analyze --fast` now writes its pages, minus
 * the `.htaccess`-denied `admin/`, and its front controller to
 * components.json serverRoutes and logs the count per docroot. Invented
 * fixture; skips when the PHP grammar is not built.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { skipUnlessPackRuns } from "../helpers/workspace-pack.js";

const CLI_PATH = join(import.meta.dirname, "../../dist/cli/index.js");

const FILES: Record<string, string> = {
  ".n-dx.json": JSON.stringify({ sourcevision: { packs: ["php"] } }),
  "site/main/classes/Account.php": "<?php\nclass Account { function name() { return 'a'; } }\n",
  "site/main/default_htdocs/index.php": "<?php\nrequire '../classes/Account.php';\necho (new Account())->name();\n",
  "site/main/default_htdocs/account.php": "<?php\nrequire '../classes/Account.php';\necho 'account';\n",
  "site/main/default_htdocs/admin/.htaccess": "Deny from all\n",
  "site/main/default_htdocs/admin/tools.php": "<?php\necho 'tools';\n",
  "site/main/default_htdocs/api/.htaccess": "RewriteEngine On\nRewriteRule ^(.*)$ router.php [L,QSA]\n",
  "site/main/default_htdocs/api/router.php": "<?php\necho 'route';\n",
};

describe("sv analyze --fast routes a nested *_htdocs docroot", { timeout: 120_000 }, () => {
  let dir: string | undefined;
  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("writes its pages and front controller to components.json serverRoutes and logs the count", async (ctx) => {
    await skipUnlessPackRuns(ctx, "php");
    dir = mkdtempSync(join(tmpdir(), "sv-php-docroot-"));
    for (const [path, content] of Object.entries(FILES)) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), content);
    }

    const run = spawnSync(process.execPath, [CLI_PATH, "analyze", dir, "--fast"], { encoding: "utf-8", timeout: 90_000 });
    const output = `${run.stdout}${run.stderr}`;
    expect(run.status, output).toBe(0);

    const components = JSON.parse(readFileSync(join(dir, ".sourcevision", "components.json"), "utf-8"));
    const routes = components.serverRoutes.flatMap((g: { routes: { method: string; path: string; file: string; source?: string }[] }) => g.routes);
    const paths = new Set(routes.map((r: { path: string }) => r.path));
    expect(paths).toContain("/index.php");
    expect(paths).toContain("/account.php");
    expect(paths).toContain("/api/router.php");
    expect([...paths].some((p) => String(p).startsWith("/admin/"))).toBe(false);
    // The front controller: a catch-all under api/, from its .htaccess line.
    expect(routes.some((r: { file: string; source?: string }) => r.file === "site/main/default_htdocs/api/router.php" && r.source === "site/main/default_htdocs/api/.htaccess:2")).toBe(true);
    expect(routes.find((r: { path: string }) => r.path === "/index.php")?.source).toBe("docroot site/main/default_htdocs");
    expect(output).toContain("routes by docroot (files served): site/main/default_htdocs 3");
  });
});
