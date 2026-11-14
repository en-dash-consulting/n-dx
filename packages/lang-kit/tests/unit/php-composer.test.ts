import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { MAX_BUILD_FILE_BYTES } from "../../src/build-file.js";
import { type ComposerProject, composerProjectsFrom, readComposerProjects } from "../../src/php-composer.js";

const FIXTURES = fileURLToPath(new URL("../fixtures/php-composer", import.meta.url));

const MONOREPO = [
  "composer.json",
  "composer.lock",
  "src/Cart.php",
  "packages/billing/composer.json",
  "packages/billing/src/Invoice.php",
  "lib/vendor/monolog/monolog/composer.json",
];

const byDir = (projects: ComposerProject[]): Record<string, ComposerProject> => Object.fromEntries(projects.map((p) => [p.dir, p]));

describe("Composer projects: composer.json", () => {
  it("reads require, PSR-4 with several paths, classmap, files, repositories and vendor-dir", async () => {
    const projects = await readComposerProjects(`${FIXTURES}/monorepo`, MONOREPO);
    const root = byDir(projects)[""];
    expect(root).toMatchObject({ dir: "", name: "acme/shop", files: ["composer.json", "composer.lock"], vendorDir: "lib/vendor", notices: [] });
    expect(root.requirements).toEqual([
      { name: "php", constraint: ">=8.1", dev: false, platform: true },
      { name: "ext-json", constraint: "*", dev: false, platform: true },
      { name: "monolog/monolog", constraint: "^3.0", dev: false },
      { name: "acme/billing", constraint: "@dev", dev: false },
      { name: "phpunit/phpunit", constraint: "^10.5", dev: true },
    ]);
    expect(root.autoload).toEqual({
      psr4: [
        { prefix: "Acme\\Shop\\", paths: ["src", "lib/shop"] },
        { prefix: "Acme\\Shared\\", paths: ["shared"] },
      ],
      psr0: [],
      classmap: ["legacy", "lib/Helpers.php"],
      files: ["src/functions.php"],
      excludeFromClassmap: ["legacy/tests"],
    });
    expect(root.autoloadDev.psr4).toEqual([{ prefix: "Acme\\Shop\\Tests\\", paths: ["tests"] }]);
    expect(root.repositories).toEqual([
      { type: "path", url: "packages/*" },
      { type: "vcs", url: "https://example.com/acme/tools.git" },
    ]);
  });

  it("gives each manifest its own model, paths relative to the repository, and skips the vendor directory", async () => {
    const projects = await readComposerProjects(`${FIXTURES}/monorepo`, MONOREPO);
    expect(projects.map((p) => p.dir)).toEqual(["", "packages/billing"]);
    const billing = byDir(projects)["packages/billing"];
    expect(billing).toMatchObject({ name: "acme/billing", files: ["packages/billing/composer.json"], vendorDir: "packages/billing/vendor", notices: [] });
    expect(billing.autoload.psr4).toEqual([{ prefix: "Acme\\Billing\\", paths: ["packages/billing/src"] }]);
    expect(billing.lockPackages).toBeUndefined();
  });

  it("reads PSR-0 with underscore-era prefixes, string or array paths, and the fallback prefix", async () => {
    const [p] = await readComposerProjects(`${FIXTURES}/zend`, ["composer.json"]);
    expect(p.autoload.psr0).toEqual([
      { prefix: "Zend_", paths: ["library"] },
      { prefix: "App_", paths: ["application/models", "application/forms"] },
      { prefix: "", paths: ["fallback"] },
    ]);
    expect(p).toMatchObject({ vendorDir: "vendor", requirements: [], repositories: [], notices: [] });
  });

  it("accepts repositories as an object keyed by name, and Windows separators in paths", async () => {
    const [p] = await composerProjectsFrom(["app/composer.json"], async () =>
      JSON.stringify({
        repositories: { tools: { type: "vcs", url: "git@example.com:t.git" }, "packagist.org": false },
        autoload: { classmap: ["src\\Legacy\\", "../shared"] },
      }),
    );
    expect(p.repositories).toEqual([{ type: "vcs", url: "git@example.com:t.git" }]);
    expect(p.autoload.classmap).toEqual(["app/src/Legacy", "shared"]);
  });
});

describe("Composer projects: composer.lock", () => {
  it("reads each package's name, version and autoload, packages then packages-dev, sorted by name", async () => {
    const [root] = await readComposerProjects(`${FIXTURES}/monorepo`, MONOREPO);
    expect(root.lockPackages).toEqual([
      { name: "acme/billing", version: "dev-main", dev: false, autoload: expect.objectContaining({ psr4: [{ prefix: "Acme\\Billing\\", paths: ["src"] }] }) },
      { name: "monolog/monolog", version: "3.5.0", dev: false, autoload: expect.objectContaining({ psr4: [{ prefix: "Monolog\\", paths: ["src/Monolog"] }] }) },
      {
        name: "phpunit/phpunit",
        version: "10.5.0",
        dev: true,
        autoload: { psr4: [], psr0: [], classmap: ["src"], files: ["src/Framework/Assert/Functions.php"], excludeFromClassmap: [] },
      },
    ]);
  });

  it("reads a lock only when the inventory lists it", async () => {
    const [root] = await readComposerProjects(`${FIXTURES}/monorepo`, ["composer.json"]);
    expect(root.files).toEqual(["composer.json"]);
    expect(root.lockPackages).toBeUndefined();
  });
});

describe("Composer projects: malformed input", () => {
  it("malformed JSON gives a notice and an empty model, never a throw", async () => {
    const projects = await readComposerProjects(`${FIXTURES}/malformed`, ["composer.json", "composer.lock", "good/composer.json"]);
    const broken = byDir(projects)[""];
    expect(broken).toMatchObject({ dir: "", files: [], requirements: [], repositories: [], vendorDir: "vendor" });
    expect(broken.name).toBeUndefined();
    expect(broken.lockPackages).toBeUndefined();
    expect(broken.autoload).toEqual({ psr4: [], psr0: [], classmap: [], files: [], excludeFromClassmap: [] });
    expect(broken.notices).toHaveLength(2);
    expect(broken.notices[0]).toMatch(/^composer\.json: not read: /);
    expect(broken.notices[1]).toMatch(/^composer\.lock: not read: /);
  });

  it("a field of the wrong type is a notice; the rest is read", async () => {
    const projects = await readComposerProjects(`${FIXTURES}/malformed`, ["good/composer.json"]);
    expect(projects).toEqual([
      expect.objectContaining({
        dir: "good",
        name: "fine/app",
        vendorDir: "good/vendor",
        notices: [
          "good/composer.json: autoload.psr-4 is not an object",
          "good/composer.json: every entry of autoload.classmap is not a string",
          "good/composer.json: config.vendor-dir is not a string",
        ],
      }),
    ]);
    expect(projects[0].autoload.classmap).toEqual(["good/src"]);
  });

  it("a non-object top level, an unreadable file, an oversized file and a lock without packages are notices", async () => {
    const repo: Record<string, string | { oversized: number } | undefined> = {
      "a/composer.json": "[1, 2]",
      "b/composer.json": undefined,
      "c/composer.json": { oversized: MAX_BUILD_FILE_BYTES + 1 },
      "d/composer.json": "﻿{}",
      "d/composer.lock": JSON.stringify({ packages: {}, "packages-dev": [{ version: "1" }] }),
    };
    const projects = await composerProjectsFrom(Object.keys(repo), async (path) => repo[path]);
    expect(projects.map((p) => [p.dir, p.notices])).toEqual([
      ["a", ["a/composer.json: not read: the top level is not an object"]],
      ["b", ["b/composer.json is unreadable"]],
      ["c", [`c/composer.json is ${MAX_BUILD_FILE_BYTES + 1} bytes, over the ${MAX_BUILD_FILE_BYTES}-byte build file limit; skipped`]],
      ["d", ["d/composer.lock: packages is not an array", "d/composer.lock: packages-dev[0] has no name"]],
    ]);
    expect(byDir(projects)["d"].lockPackages).toEqual([]);
  });

  it("a manifest missing from the disk is unreadable", async () => {
    const [p] = await readComposerProjects(`${FIXTURES}/zend`, ["missing/composer.json"]);
    expect(p.notices).toEqual(["missing/composer.json is unreadable"]);
  });
});
