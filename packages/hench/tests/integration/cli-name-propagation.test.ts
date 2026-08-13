/**
 * Integration test — resolved CLI name propagation (Project-Aware CLI Identity).
 *
 * A hench run in a project configured with `cli.name: "myapp"` must receive
 * "myapp" in its rendered prompt context (system prompt + task brief), not
 * the hardcoded default "ndx".
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assembleTaskBrief, formatTaskBrief } from "../../src/agent/planning/brief.js";
import { buildSystemPrompt } from "../../src/agent/planning/prompt.js";
import { DEFAULT_HENCH_CONFIG } from "../../src/schema/v1.js";
import { mockStoreWithDefaults } from "../helpers/index.js";

describe("cli.name propagation into prompt context", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "cli-name-prop-"));
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("renders cli.name='myapp' in the prompt context, not 'ndx'", async () => {
    writeFileSync(join(projectDir, ".n-dx.json"), JSON.stringify({ cli: { name: "myapp" } }));
    const store = mockStoreWithDefaults([
      { id: "t1", title: "Do the thing", status: "pending", level: "task" },
    ]);

    const { brief } = await assembleTaskBrief(store, undefined, { projectDir });
    expect(brief.project.cliName).toBe("myapp");

    const system = buildSystemPrompt(brief.project, DEFAULT_HENCH_CONFIG());
    const briefText = formatTaskBrief(brief);
    expect(system).toContain("myapp");
    expect(system).not.toContain("CLI command: `n-dx`");
    expect(briefText).toContain("CLI: `myapp`");
  });

  it("defaults to n-dx when the project has no cli.name", async () => {
    const store = mockStoreWithDefaults([
      { id: "t1", title: "Do the thing", status: "pending", level: "task" },
    ]);

    const { brief } = await assembleTaskBrief(store, undefined, { projectDir });
    expect(brief.project.cliName).toBe("n-dx");

    const system = buildSystemPrompt(brief.project, DEFAULT_HENCH_CONFIG());
    expect(system).toContain("CLI command: `n-dx`");
  });
});
