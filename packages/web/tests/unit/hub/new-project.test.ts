/**
 * Planning a new project folder.
 *
 * The contract the UI depends on: before anything is created, the operator is
 * shown the exact absolute path, and a path that cannot be created says why
 * instead of failing at `mkdir` time.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";

import {
  planNewProject,
  validateProjectName,
  slugifyProjectId,
  deriveProjectId,
  defaultParentDir,
} from "../../../src/hub/new-project.js";

describe("validateProjectName", () => {
  it("accepts an ordinary folder name", () => {
    expect(validateProjectName("my-project")).toBeNull();
    expect(validateProjectName("  spaced  ")).toBeNull();
  });

  it("refuses a path rather than silently creating nested folders", () => {
    expect(validateProjectName("a/b")).toMatch(/one folder/);
    expect(validateProjectName("a\\b")).toMatch(/one folder/);
  });

  it("refuses names that would not survive a round trip", () => {
    expect(validateProjectName("")).toMatch(/Enter a folder name/);
    expect(validateProjectName("..")).toMatch(/not a folder name/);
    expect(validateProjectName("C:")).toMatch(/colon/);
    expect(validateProjectName("trailing.")).toMatch(/dot or a space/);
    expect(validateProjectName("CON")).toMatch(/reserved device name/);
    expect(validateProjectName("x".repeat(200))).toMatch(/under 100/);
  });
});

describe("planNewProject", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "new-project-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("resolves the absolute path that would be created", () => {
    const plan = planNewProject({ parent: tmpDir, name: "my-app" });
    expect(plan.ok).toBe(true);
    expect(plan.path).toBe(join(tmpDir, "my-app"));
    expect(plan.problem).toBeNull();
    expect(plan.exists).toBe(false);
  });

  it("resolves a relative or dot-laden parent to what it actually is", () => {
    const plan = planNewProject({ parent: `${tmpDir}${sep}sub${sep}..`, name: "app" });
    expect(plan.parent).toBe(resolve(tmpDir));
    expect(plan.path).toBe(join(tmpDir, "app"));
  });

  it("refuses a parent that does not exist, naming it", () => {
    const missing = join(tmpDir, "nope");
    const plan = planNewProject({ parent: missing, name: "app" });
    expect(plan.ok).toBe(false);
    expect(plan.problem).toContain(missing);
  });

  it("refuses a parent that is a file", async () => {
    const file = join(tmpDir, "a-file");
    await writeFile(file, "x");
    const plan = planNewProject({ parent: file, name: "app" });
    expect(plan.ok).toBe(false);
    expect(plan.problem).toMatch(/file, not a folder/);
  });

  it("refuses a target that already has content, and points at ndx start", async () => {
    await mkdir(join(tmpDir, "taken"));
    await writeFile(join(tmpDir, "taken", "README.md"), "#");
    const plan = planNewProject({ parent: tmpDir, name: "taken" });
    expect(plan.ok).toBe(false);
    expect(plan.exists).toBe(true);
    expect(plan.problem).toMatch(/not empty/);
    expect(plan.problem).toMatch(/ndx start/);
  });

  it("adopts an existing empty folder, saying so", async () => {
    await mkdir(join(tmpDir, "empty"));
    const plan = planNewProject({ parent: tmpDir, name: "empty" });
    expect(plan.ok).toBe(true);
    expect(plan.exists).toBe(true);
    expect(plan.note).toMatch(/already exists and is empty/);
  });

  it("refuses a file of the same name", async () => {
    await writeFile(join(tmpDir, "clash"), "x");
    const plan = planNewProject({ parent: tmpDir, name: "clash" });
    expect(plan.ok).toBe(false);
    expect(plan.problem).toMatch(/file of that name/);
  });

  it("still reports a path while the name is being typed", () => {
    const plan = planNewProject({ parent: tmpDir, name: "" });
    expect(plan.ok).toBe(false);
    expect(plan.path).toBe(resolve(tmpDir));
  });

  it("refuses a name that would escape the parent", () => {
    const plan = planNewProject({ parent: tmpDir, name: `..${sep}elsewhere` });
    expect(plan.ok).toBe(false);
    // The preview never shows a path outside the parent for a refused name.
    expect(plan.path).toBe(resolve(tmpDir));
  });
});

describe("project ids", () => {
  it("slugifies a folder name the way `ndx start` does", () => {
    expect(slugifyProjectId("My App")).toBe("my-app");
    expect(slugifyProjectId("n-dx")).toBe("n-dx");
    expect(slugifyProjectId("...")).toBe("project");
  });

  it("uses the bare slug when nothing holds it", () => {
    expect(deriveProjectId(join("/repos", "alpha"), new Map())).toBe("alpha");
  });

  it("keeps the slug for the same folder registered again", () => {
    const taken = new Map([["alpha", join("/repos", "alpha")]]);
    expect(deriveProjectId(join("/repos", "alpha"), taken)).toBe("alpha");
  });

  it("hashes the path when another folder already holds the slug", () => {
    const taken = new Map([["alpha", join("/repos", "alpha")]]);
    const id = deriveProjectId(join("/other", "alpha"), taken);
    expect(id).toMatch(/^alpha-[0-9a-f]{6}$/);
  });
});

describe("defaultParentDir", () => {
  const home = join(sep, "home", "dev");

  it("falls back to home when nothing is registered", () => {
    expect(defaultParentDir([], home)).toBe(resolve(home));
  });

  it("offers wherever most registered projects already live", () => {
    const parent = defaultParentDir(
      [
        join(sep, "code", "alpha"),
        join(sep, "code", "beta"),
        join(sep, "elsewhere", "gamma"),
      ],
      home,
    );
    expect(parent).toBe(resolve(join(sep, "code")));
  });
});
