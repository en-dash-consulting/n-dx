import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { cmdValidate } from "../../../../src/cli/commands/validate.js";
import { writePRD, writeConfig } from "../../../helpers/rex-dir-test-support.js";
import { serializeFolderTree } from "../../../../src/store/folder-tree-serializer.js";
import { serializeDocument } from "../../../../src/store/markdown-serializer.js";
import { FileStore } from "../../../../src/store/file-adapter.js";
import type { PRDDocument } from "../../../../src/schema/index.js";
import { SCHEMA_VERSION } from "../../../../src/schema/index.js";
import { PRD_TREE_DIRNAME, TREE_META_FILENAME, SLUG_RULE_VERSION } from "../../../../src/store/index.js";
import { parseTreeMeta } from "../../../../src/store/tree-meta.js";

const VALID_CONFIG = {
  schema: "rex/v1",
  project: "test-validate",
  adapter: "file",
};

const VALID_PRD: PRDDocument = {
  schema: "rex/v1",
  title: "Test Project",
  items: [
    {
      id: "e1",
      title: "Epic One",
      level: "epic",
      status: "pending",
      priority: "medium",
      children: [
        {
          id: "t1",
          title: "Task One",
          level: "task",
          status: "completed",
          priority: "medium",
          startedAt: "2026-01-01T00:00:00.000Z",
          completedAt: "2026-01-02T00:00:00.000Z",
        },
      ],
    },
  ],
};

describe("cmdValidate", () => {
  let tmpDir: string;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "rex-validate-test-"));
    mkdirSync(join(tmpDir, ".rex"), { recursive: true });
    exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called");
    }) as never);
    stdoutSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    exitSpy.mockRestore();
    stdoutSpy.mockRestore();
  });

  // ── Exit code behavior ────────────────────────────────────────────────────

  describe("exit codes", () => {
    it("exits 0 when all checks pass (text mode)", async () => {
      writeConfig(tmpDir, VALID_CONFIG);
      writePRD(tmpDir, VALID_PRD);

      await cmdValidate(tmpDir, {});
      // No process.exit call means exit code 0
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it("exits 0 when all checks pass (JSON mode)", async () => {
      writeConfig(tmpDir, VALID_CONFIG);
      writePRD(tmpDir, VALID_PRD);

      await cmdValidate(tmpDir, { format: "json" });
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it("exits 1 on schema validation errors (text mode)", async () => {
      writeConfig(tmpDir, VALID_CONFIG);
      writeFileSync(
        join(tmpDir, ".rex", "prd.json"),
        JSON.stringify({ invalid: true }),
      );

      await expect(cmdValidate(tmpDir, {})).rejects.toThrow("process.exit");
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it("exits 1 on schema validation errors (JSON mode)", async () => {
      writeConfig(tmpDir, VALID_CONFIG);
      writeFileSync(
        join(tmpDir, ".rex", "prd.json"),
        JSON.stringify({ invalid: true }),
      );

      await expect(cmdValidate(tmpDir, { format: "json" })).rejects.toThrow("process.exit");
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it("exits 1 on orphaned items", async () => {
      writeConfig(tmpDir, VALID_CONFIG);
      // Task at root level is an orphan — tasks must be under feature or epic
      writePRD(tmpDir, {
        schema: "rex/v1",
        title: "Test",
        items: [
          {
            id: "sub1",
            title: "Orphan Subtask",
            level: "subtask",
            status: "pending",
          },
        ],
      });

      await expect(cmdValidate(tmpDir, {})).rejects.toThrow("process.exit");
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it("exits 1 on orphaned items (JSON mode)", async () => {
      writeConfig(tmpDir, VALID_CONFIG);
      writePRD(tmpDir, {
        schema: "rex/v1",
        title: "Test",
        items: [
          {
            id: "sub1",
            title: "Orphan Subtask",
            level: "subtask",
            status: "pending",
          },
        ],
      });

      await expect(cmdValidate(tmpDir, { format: "json" })).rejects.toThrow("process.exit");
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it("exits 0 when only warnings exist (stuck tasks)", async () => {
      writeConfig(tmpDir, VALID_CONFIG);
      writePRD(tmpDir, {
        schema: "rex/v1",
        title: "Test",
        items: [
          {
            id: "e1",
            title: "Epic",
            level: "epic",
            status: "pending",
            children: [
              {
                id: "t1",
                title: "Stuck Task",
                level: "task",
                status: "in_progress",
                // no startedAt → stuck warning
              },
            ],
          },
        ],
      });

      // Warnings do not cause exit(1)
      await cmdValidate(tmpDir, {});
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it("exits 0 when only warnings exist (JSON mode)", async () => {
      writeConfig(tmpDir, VALID_CONFIG);
      writePRD(tmpDir, {
        schema: "rex/v1",
        title: "Test",
        items: [
          {
            id: "e1",
            title: "Epic",
            level: "epic",
            status: "pending",
            children: [
              {
                id: "t1",
                title: "Stuck Task",
                level: "task",
                status: "in_progress",
              },
            ],
          },
        ],
      });

      await cmdValidate(tmpDir, { format: "json" });
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it("exits 1 on DAG errors (duplicate IDs)", async () => {
      writeConfig(tmpDir, VALID_CONFIG);
      writePRD(tmpDir, {
        schema: "rex/v1",
        title: "Test",
        items: [
          {
            id: "e1",
            title: "Epic A",
            level: "epic",
            status: "pending",
          },
          {
            id: "e1",
            title: "Epic B (duplicate)",
            level: "epic",
            status: "pending",
          },
        ],
      });

      await expect(cmdValidate(tmpDir, {})).rejects.toThrow("process.exit");
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it("exits 1 on blockedBy cycles", async () => {
      writeConfig(tmpDir, VALID_CONFIG);
      writePRD(tmpDir, {
        schema: "rex/v1",
        title: "Test",
        items: [
          {
            id: "e1",
            title: "Epic",
            level: "epic",
            status: "pending",
            children: [
              {
                id: "t1",
                title: "Task A",
                level: "task",
                status: "pending",
                blockedBy: ["t2"],
              },
              {
                id: "t2",
                title: "Task B",
                level: "task",
                status: "pending",
                blockedBy: ["t1"],
              },
            ],
          },
        ],
      });

      await expect(cmdValidate(tmpDir, {})).rejects.toThrow("process.exit");
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  // ── Slug conformance ──────────────────────────────────────────────────────
  // A tree a foreign-slug-rule build rewrote must fail validate, not warn: the
  // next write rewrites it again. See findNonConformingSlugs (issue: a
  // 1,570-file re-slug merged to main because this check was severity "warn").

  describe("slug conformance", () => {
    const SLUG_DOC = {
      schema: "rex/v1" as const,
      title: "Slug Conformance",
      items: [
        {
          id: "epic-abc123",
          title: "Child Process Cleanup And Exit Hygiene",
          level: "epic" as const,
          status: "pending" as const,
          // A child makes the epic a directory (not a bare leaf `.md`), which
          // is the shape findNonConformingSlugs' id-qualified fixture needs.
          children: [
            { id: "task-def456", title: "Harden the runner", level: "task" as const, status: "pending" as const },
          ],
        },
      ],
    };

    it("exits 1 when a path was written by a foreign slug rule", async () => {
      writeConfig(tmpDir, VALID_CONFIG);
      await new FileStore(join(tmpDir, ".rex")).saveDocument(SLUG_DOC);

      const treeRoot = join(tmpDir, ".rex", PRD_TREE_DIRNAME);
      const current = readdirSync(treeRoot).filter((e) => e !== "tree-meta.json")[0];
      // Exactly what a build on the other side of the id-suffix change
      // produces: the same content under the superseded id-qualified name.
      renameSync(join(treeRoot, current), join(treeRoot, "child-process-cleanup-and-exit-epicab"));

      await expect(cmdValidate(tmpDir, {})).rejects.toThrow("process.exit");
      expect(exitSpy).toHaveBeenCalledWith(1);

      const output = stdoutSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain("✗ tree slug convention");
      expect(output).toContain("child-process-cleanup-and-exit-epicab");
      expect(output).toContain("rex migrate-slugs");
    });

    it("reports the slug check as severity=error in JSON output", async () => {
      writeConfig(tmpDir, VALID_CONFIG);
      await new FileStore(join(tmpDir, ".rex")).saveDocument(SLUG_DOC);

      const treeRoot = join(tmpDir, ".rex", PRD_TREE_DIRNAME);
      const current = readdirSync(treeRoot).filter((e) => e !== "tree-meta.json")[0];
      renameSync(join(treeRoot, current), join(treeRoot, "child-process-cleanup-and-exit-epicab"));

      await expect(cmdValidate(tmpDir, { format: "json" })).rejects.toThrow("process.exit");
      expect(exitSpy).toHaveBeenCalledWith(1);

      const jsonCall = stdoutSpy.mock.calls.find((c) => {
        try {
          JSON.parse(c[0]);
          return true;
        } catch {
          return false;
        }
      });
      const report = JSON.parse(jsonCall![0]);
      const slugCheck = report.checks.find((c: { name: string }) => c.name === "tree slug convention");
      expect(slugCheck).toBeDefined();
      expect(slugCheck.pass).toBe(false);
      expect(slugCheck.severity).toBe("error");
      expect(report.ok).toBe(false);
    });

    it("exits 0 with no slug output on a conformant tree", async () => {
      writeConfig(tmpDir, VALID_CONFIG);
      await new FileStore(join(tmpDir, ".rex")).saveDocument(SLUG_DOC);

      await cmdValidate(tmpDir, {});
      expect(exitSpy).not.toHaveBeenCalled();

      const output = stdoutSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).not.toContain("tree slug convention");
    });

    // The path scan above can only recognise a rule it can itself compute. A
    // tree written by a *future* rule has paths this build cannot derive, so
    // the recorded marker is the only evidence that anything is wrong.
    it("exits 1 when the recorded slug rule is not this build's", async () => {
      writeConfig(tmpDir, VALID_CONFIG);
      const rexDir = join(tmpDir, ".rex");
      await new FileStore(rexDir).saveDocument(SLUG_DOC);

      const metaPath = join(rexDir, TREE_META_FILENAME);
      const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
      writeFileSync(metaPath, JSON.stringify({ ...meta, slugRule: SLUG_RULE_VERSION + 1 }));

      await expect(cmdValidate(tmpDir, {})).rejects.toThrow("process.exit");
      expect(exitSpy).toHaveBeenCalledWith(1);

      const output = stdoutSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain("✗ tree slug rule marker");
      expect(output).toContain(`slug rule ${SLUG_RULE_VERSION + 1}`);
      expect(output).toContain(`slug rule ${SLUG_RULE_VERSION}`);
      expect(output).toContain("rex migrate-slugs");
    });

    // Absence used to be tolerated as "a tree older than the marker". It is
    // reported as an error now because a build older than the field rewrites
    // the sidecar without it — erasing the record while moving no path — so a
    // missing marker is as likely to be a disarmed guard as an old tree, and
    // CI is where that has to be caught rather than mid-run.
    it("exits 1 when the tree carries no slug-rule marker at all", async () => {
      writeConfig(tmpDir, VALID_CONFIG);
      const rexDir = join(tmpDir, ".rex");
      await new FileStore(rexDir).saveDocument(SLUG_DOC);

      const metaPath = join(rexDir, TREE_META_FILENAME);
      const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
      delete meta.slugRule;
      writeFileSync(metaPath, JSON.stringify(meta));

      await expect(cmdValidate(tmpDir, {})).rejects.toThrow("process.exit");
      expect(exitSpy).toHaveBeenCalledWith(1);

      const output = stdoutSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain("✗ tree slug rule marker");
      expect(output).toContain("slug rule marker missing; run rex migrate-slugs");
    });

    // The marker describes the folder tree, so a project that has no folder
    // tree cannot be missing one. `ensureLegacyPrdMigrated` only converts a
    // `prd.json` source, so a checkout still on `prd.md` reaches validate with
    // items and no tree — and judging the check by `doc.items` failed it, with
    // advice (`rex migrate-slugs`) that refuses a project with no tree to
    // migrate. An error with no way out, on a checkout with nothing wrong.
    it("does not demand a marker from a legacy prd.md project with no tree", async () => {
      writeConfig(tmpDir, VALID_CONFIG);
      writeFileSync(
        join(tmpDir, ".rex", "prd.md"),
        serializeDocument({
          schema: "rex/v1",
          title: "Legacy PRD",
          items: [
            {
              id: "e1",
              title: "Alpha Epic",
              level: "epic",
              status: "pending",
              priority: "medium",
              children: [
                { id: "t1", title: "Alpha Task", level: "task", status: "pending", priority: "medium" },
              ],
            },
          ],
        } as PRDDocument),
      );
      expect(existsSync(join(tmpDir, ".rex", PRD_TREE_DIRNAME))).toBe(false);

      await cmdValidate(tmpDir, {});

      expect(exitSpy).not.toHaveBeenCalled();
      const output = stdoutSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).not.toContain("tree slug rule marker");
    });

    it("reports the missing-marker check as severity=error in JSON output", async () => {
      writeConfig(tmpDir, VALID_CONFIG);
      const rexDir = join(tmpDir, ".rex");
      await new FileStore(rexDir).saveDocument(SLUG_DOC);

      const metaPath = join(rexDir, TREE_META_FILENAME);
      const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
      delete meta.slugRule;
      writeFileSync(metaPath, JSON.stringify(meta));

      await expect(cmdValidate(tmpDir, { format: "json" })).rejects.toThrow("process.exit");

      const jsonCall = stdoutSpy.mock.calls.find((c) => {
        try {
          JSON.parse(c[0]);
          return true;
        } catch {
          return false;
        }
      });
      const report = JSON.parse(jsonCall![0]);
      const check = report.checks.find((c: { name: string }) => c.name === "tree slug rule marker");
      expect(check).toBeDefined();
      expect(check.pass).toBe(false);
      expect(check.severity).toBe("error");
      expect(report.ok).toBe(false);
    });

    it("reports the marker check as severity=error in JSON output", async () => {
      writeConfig(tmpDir, VALID_CONFIG);
      const rexDir = join(tmpDir, ".rex");
      await new FileStore(rexDir).saveDocument(SLUG_DOC);

      const metaPath = join(rexDir, TREE_META_FILENAME);
      const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
      writeFileSync(metaPath, JSON.stringify({ ...meta, slugRule: 1 }));

      await expect(cmdValidate(tmpDir, { format: "json" })).rejects.toThrow("process.exit");

      const jsonCall = stdoutSpy.mock.calls.find((c) => {
        try {
          JSON.parse(c[0]);
          return true;
        } catch {
          return false;
        }
      });
      const report = JSON.parse(jsonCall![0]);
      const check = report.checks.find((c: { name: string }) => c.name === "tree slug rule marker");
      expect(check).toBeDefined();
      expect(check.pass).toBe(false);
      expect(check.severity).toBe("error");
      expect(report.ok).toBe(false);
    });

    it("stays silent when the marker matches this build", async () => {
      writeConfig(tmpDir, VALID_CONFIG);
      const rexDir = join(tmpDir, ".rex");
      await new FileStore(rexDir).saveDocument(SLUG_DOC);

      // The save above records the marker; nothing further is needed.
      const meta = JSON.parse(readFileSync(join(rexDir, TREE_META_FILENAME), "utf-8"));
      expect(meta.slugRule).toBe(SLUG_RULE_VERSION);

      await cmdValidate(tmpDir, {});
      expect(exitSpy).not.toHaveBeenCalled();

      const output = stdoutSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).not.toContain("tree slug rule marker");
    });

    // The sidecar is a `.passthrough()`-style read on purpose: an older rex
    // must keep loading a tree a newer one marked, or the marker would break
    // every checkout it was meant to protect.
    it("leaves the rest of the sidecar parse untouched by the extra key", async () => {
      const raw = JSON.stringify({
        title: "Slug Conformance",
        schema: SCHEMA_VERSION,
        slugRule: SLUG_RULE_VERSION,
        unknownFutureKey: "ignored",
      });
      expect(parseTreeMeta(raw)).toEqual({
        title: "Slug Conformance",
        schema: SCHEMA_VERSION,
        slugRule: SLUG_RULE_VERSION,
      });
    });
  });

  // ── Error reporting ───────────────────────────────────────────────────────

  describe("error reporting", () => {
    it("reports validation errors clearly in text mode", async () => {
      writeConfig(tmpDir, VALID_CONFIG);
      // Schema field is required by the parser; omitting it makes the PRD
      // unparseable, which validate surfaces as a "PRD schema" failure.
      writeFileSync(
        join(tmpDir, ".rex", "prd.md"),
        "---\ntitle: x\n---\n",
      );

      await expect(cmdValidate(tmpDir, {})).rejects.toThrow("process.exit");

      const output = stdoutSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain("✗ PRD schema");
      expect(output).toContain("Validation failed.");
    });

    it("reports orphaned items clearly in text mode", async () => {
      writeConfig(tmpDir, VALID_CONFIG);
      writePRD(tmpDir, {
        schema: "rex/v1",
        title: "Test",
        items: [
          {
            id: "sub1",
            title: "Orphan",
            level: "subtask",
            status: "pending",
          },
        ],
      });

      await expect(cmdValidate(tmpDir, {})).rejects.toThrow("process.exit");

      const output = stdoutSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain("✗ hierarchy placement");
      expect(output).toContain("sub1");
    });

    it("reports errors in JSON output with pass=false", async () => {
      writeConfig(tmpDir, VALID_CONFIG);
      writePRD(tmpDir, {
        schema: "rex/v1",
        title: "Test",
        items: [
          {
            id: "sub1",
            title: "Orphan",
            level: "subtask",
            status: "pending",
          },
        ],
      });

      await expect(cmdValidate(tmpDir, { format: "json" })).rejects.toThrow("process.exit");

      // Find the JSON output call
      const jsonCall = stdoutSpy.mock.calls.find((c) => {
        try {
          JSON.parse(c[0]);
          return true;
        } catch {
          return false;
        }
      });
      expect(jsonCall).toBeDefined();
      const report = JSON.parse(jsonCall![0]);
      const hierarchyCheck = report.checks.find((c: { name: string }) => c.name === "hierarchy placement");
      expect(hierarchyCheck).toBeDefined();
      expect(hierarchyCheck.pass).toBe(false);
      expect(hierarchyCheck.errors.length).toBeGreaterThan(0);
      expect(hierarchyCheck.errors[0]).toContain("sub1");
    });

    it("warns are shown but do not appear as failures in JSON", async () => {
      writeConfig(tmpDir, VALID_CONFIG);
      writePRD(tmpDir, {
        schema: "rex/v1",
        title: "Test",
        items: [
          {
            id: "e1",
            title: "Epic",
            level: "epic",
            status: "pending",
            children: [
              {
                id: "t1",
                title: "Stuck",
                level: "task",
                status: "in_progress",
              },
            ],
          },
        ],
      });

      await cmdValidate(tmpDir, { format: "json" });

      const jsonCall = stdoutSpy.mock.calls.find((c) => {
        try {
          JSON.parse(c[0]);
          return true;
        } catch {
          return false;
        }
      });
      expect(jsonCall).toBeDefined();
      const report = JSON.parse(jsonCall![0]);
      const stuckCheck = report.checks.find((c: { name: string }) => c.name === "stuck tasks");
      expect(stuckCheck).toBeDefined();
      expect(stuckCheck.pass).toBe(false);
      expect(stuckCheck.severity).toBe("warn");
    });

    it("reports timestamp inconsistency warnings in text mode", async () => {
      writeConfig(tmpDir, VALID_CONFIG);
      writePRD(tmpDir, {
        schema: "rex/v1",
        title: "Test",
        items: [
          {
            id: "e1",
            title: "Epic",
            level: "epic",
            status: "pending",
            children: [
              {
                id: "t1",
                title: "Completed no timestamp",
                level: "task",
                status: "completed",
              },
            ],
          },
        ],
      });

      await cmdValidate(tmpDir, {});
      const output = stdoutSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain("⚠ timestamp consistency");
      expect(output).toContain("completedAt");
    });

    it("reports parent-child inconsistency warnings in text mode", async () => {
      writeConfig(tmpDir, VALID_CONFIG);
      writePRD(tmpDir, {
        schema: "rex/v1",
        title: "Test",
        items: [
          {
            id: "e1",
            title: "Completed epic",
            level: "epic",
            status: "completed",
            startedAt: "2026-01-01T00:00:00.000Z",
            completedAt: "2026-01-10T00:00:00.000Z",
            children: [
              {
                id: "t1",
                title: "Still pending",
                level: "task",
                status: "pending",
              },
            ],
          },
        ],
      });

      await cmdValidate(tmpDir, {});
      const output = stdoutSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain("⚠ parent-child status consistency");
      expect(output).toContain("non-terminal");
    });

    it("reports timestamp warnings in JSON output with severity=warn", async () => {
      writeConfig(tmpDir, VALID_CONFIG);
      writePRD(tmpDir, {
        schema: "rex/v1",
        title: "Test",
        items: [
          {
            id: "e1",
            title: "Epic",
            level: "epic",
            status: "pending",
            children: [
              {
                id: "t1",
                title: "Completed no ts",
                level: "task",
                status: "completed",
              },
            ],
          },
        ],
      });

      await cmdValidate(tmpDir, { format: "json" });

      const jsonCall = stdoutSpy.mock.calls.find((c) => {
        try {
          JSON.parse(c[0]);
          return true;
        } catch {
          return false;
        }
      });
      expect(jsonCall).toBeDefined();
      const report = JSON.parse(jsonCall![0]);
      const tsCheck = report.checks.find((c: { name: string }) => c.name === "timestamp consistency");
      expect(tsCheck).toBeDefined();
      expect(tsCheck.pass).toBe(false);
      expect(tsCheck.severity).toBe("warn");
      // Warnings don't cause failure
      expect(report.ok).toBe(true);
    });

    it("reports empty container warnings in text mode", async () => {
      writeConfig(tmpDir, VALID_CONFIG);
      writePRD(tmpDir, {
        schema: "rex/v1",
        title: "Test",
        items: [
          {
            id: "e1",
            title: "Empty Epic",
            level: "epic",
            status: "pending",
          },
        ],
      });

      await cmdValidate(tmpDir, {});
      const output = stdoutSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain("⚠ empty containers");
      expect(output).toContain("e1");
    });

    it("reports empty container warnings in JSON output with severity=warn", async () => {
      writeConfig(tmpDir, VALID_CONFIG);
      writePRD(tmpDir, {
        schema: "rex/v1",
        title: "Test",
        items: [
          {
            id: "e1",
            title: "Empty Epic",
            level: "epic",
            status: "pending",
          },
        ],
      });

      await cmdValidate(tmpDir, { format: "json" });

      const jsonCall = stdoutSpy.mock.calls.find((c) => {
        try {
          JSON.parse(c[0]);
          return true;
        } catch {
          return false;
        }
      });
      expect(jsonCall).toBeDefined();
      const report = JSON.parse(jsonCall![0]);
      const ecCheck = report.checks.find((c: { name: string }) => c.name === "empty containers");
      expect(ecCheck).toBeDefined();
      expect(ecCheck.pass).toBe(false);
      expect(ecCheck.severity).toBe("warn");
      expect(ecCheck.errors[0]).toContain("e1");
      // Warnings don't cause failure
      expect(report.ok).toBe(true);
    });

    it("does not warn about epics with children", async () => {
      writeConfig(tmpDir, VALID_CONFIG);
      writePRD(tmpDir, VALID_PRD);

      await cmdValidate(tmpDir, { format: "json" });

      const jsonCall = stdoutSpy.mock.calls.find((c) => {
        try {
          JSON.parse(c[0]);
          return true;
        } catch {
          return false;
        }
      });
      expect(jsonCall).toBeDefined();
      const report = JSON.parse(jsonCall![0]);
      const ecCheck = report.checks.find((c: { name: string }) => c.name === "empty containers");
      expect(ecCheck).toBeDefined();
      expect(ecCheck.pass).toBe(true);
    });

    it("includes a summary field in JSON output", async () => {
      writeConfig(tmpDir, VALID_CONFIG);
      writePRD(tmpDir, {
        schema: "rex/v1",
        title: "Test",
        items: [
          {
            id: "sub1",
            title: "Orphan",
            level: "subtask",
            status: "pending",
          },
        ],
      });

      await expect(cmdValidate(tmpDir, { format: "json" })).rejects.toThrow("process.exit");

      const jsonCall = stdoutSpy.mock.calls.find((c) => {
        try {
          const parsed = JSON.parse(c[0]);
          return parsed && typeof parsed === "object" && "ok" in parsed;
        } catch {
          return false;
        }
      });
      expect(jsonCall).toBeDefined();
      const report = JSON.parse(jsonCall![0]);
      expect(report.ok).toBe(false);
      expect(report.checks).toBeDefined();
      expect(report.summary).toBeDefined();
      expect(report.summary.failed).toBeGreaterThan(0);
    });
  });
});

// ── Folder-tree read path ──────────────────────────────────────────────────────

const VALID_CONFIG_FOR_TREE = {
  schema: "rex/v1",
  project: "tree-validate-test",
  adapter: "file",
};

const VALID_PRD_FOR_TREE: PRDDocument = {
  schema: "rex/v1",
  title: "Tree Validate Test",
  items: [
    {
      id: "e1",
      title: "Epic One",
      level: "epic",
      status: "pending",
      children: [
        {
          id: "f1",
          title: "Feature One",
          level: "feature",
          status: "pending",
          acceptanceCriteria: ["Criterion A"],
        },
      ],
    },
  ],
};

describe("cmdValidate — folder tree read path", () => {
  let tmpDir: string;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  /**
   * `serializeFolderTree` writes the tree but not the sidecar, and a tree with
   * no slug-rule marker is now a validate error in its own right. Without
   * this, every test below would fail on the marker rather than on whatever it
   * set out to check.
   */
  function seedTreeMeta(title: string): void {
    writeFileSync(
      join(tmpDir, ".rex", TREE_META_FILENAME),
      JSON.stringify({ title, schema: SCHEMA_VERSION, slugRule: SLUG_RULE_VERSION }),
    );
  }

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "rex-validate-tree-test-"));
    mkdirSync(join(tmpDir, ".rex"), { recursive: true });
    exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called");
    }) as never);
    stdoutSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    exitSpy.mockRestore();
    stdoutSpy.mockRestore();
  });

  it("passes all structural checks when tree exists and items are valid", async () => {
    writeFileSync(join(tmpDir, ".rex", "config.json"), JSON.stringify(VALID_CONFIG_FOR_TREE));
    writeFileSync(join(tmpDir, ".rex", "prd.json"), JSON.stringify(VALID_PRD_FOR_TREE));
    await serializeFolderTree(VALID_PRD_FOR_TREE.items, join(tmpDir, ".rex", PRD_TREE_DIRNAME));
    seedTreeMeta(VALID_PRD_FOR_TREE.title);

    await cmdValidate(tmpDir, {});
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("falls back to legacy prd.json when tree is absent, structural checks pass", async () => {
    writeFileSync(join(tmpDir, ".rex", "config.json"), JSON.stringify(VALID_CONFIG_FOR_TREE));
    writeFileSync(join(tmpDir, ".rex", "prd.json"), JSON.stringify(VALID_PRD_FOR_TREE));
    // No tree pre-created — FileStore should read the legacy JSON source.

    await cmdValidate(tmpDir, {});

    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("reports same issues from tree as from prd.json (empty-container warning)", async () => {
    const prdWithEmptyEpic: PRDDocument = {
      schema: "rex/v1",
      title: "Tree Validate Test",
      items: [
        {
          id: "e1",
          title: "Empty Epic",
          level: "epic",
          status: "pending",
          // no children → empty container warning
        },
      ],
    };

    writeFileSync(join(tmpDir, ".rex", "config.json"), JSON.stringify(VALID_CONFIG_FOR_TREE));
    writeFileSync(join(tmpDir, ".rex", "prd.json"), JSON.stringify(prdWithEmptyEpic));
    await serializeFolderTree(prdWithEmptyEpic.items, join(tmpDir, ".rex", PRD_TREE_DIRNAME));
    seedTreeMeta(prdWithEmptyEpic.title);

    await cmdValidate(tmpDir, { format: "json" });

    const jsonCall = stdoutSpy.mock.calls.find((c) => {
      try {
        const parsed = JSON.parse(c[0]);
        return parsed && "ok" in parsed;
      } catch {
        return false;
      }
    });
    const report = JSON.parse(jsonCall![0]);
    const emptyCheck = report.checks.find(
      (c: { name: string }) => c.name === "empty containers",
    );
    expect(emptyCheck).toBeDefined();
    expect(emptyCheck.pass).toBe(false);
  });
});
