// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { SettingsOverlay } from "../../../src/viewer/components/settings-overlay.js";
import { buildValidViews } from "../../../src/shared/index.js";
import { Breadcrumb } from "../../../src/viewer/components/breadcrumb.js";
import { WorkflowView } from "../../../src/viewer/views/workflow.js";
import { ProjectView } from "../../../src/viewer/views/project.js";
import { resolveCliLabel, clearProjectMetadataCache } from "../../../src/viewer/hooks/use-project-metadata.js";

/**
 * Serves /api/project. Every other API answers an empty 200, or — with
 * `otherApisFail`, for pages that read a real payload — a 404.
 */
function stubProject(cliName?: string, { otherApisFail = false } = {}) {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (String(url).includes("/api/project")) {
      return {
        ok: true, status: 200,
        json: async () => ({
          name: "demo", description: null, version: null, git: null,
          nameSource: "directory", ...(cliName ? { cliName } : {}),
        }),
      };
    }
    return otherApisFail
      ? { ok: false, status: 404, json: async () => ({}) }
      : { ok: true, status: 200, json: async () => ({}) };
  }));
}

async function settle() {
  await new Promise((r) => setTimeout(r, 10));
  await act(async () => {});
}

describe("resolveCliLabel", () => {
  it("substitutes every occurrence of the placeholder", () => {
    expect(resolveCliLabel("{cli} work / {cli} sync", "myapp")).toBe("myapp work / myapp sync");
  });

  it("leaves templates without the placeholder untouched", () => {
    expect(resolveCliLabel("Feature Flags", "myapp")).toBe("Feature Flags");
  });
});

describe("dashboard labels use the project CLI name", () => {
  let root: HTMLDivElement;

  beforeEach(() => {
    clearProjectMetadataCache();
    root = document.createElement("div");
    document.body.appendChild(root);
  });

  afterEach(() => {
    render(null, root);
    root.remove();
    vi.unstubAllGlobals();
  });

  it("settings list never shows an unresolved placeholder or a bare ndx", async () => {
    stubProject("myapp");
    act(() => {
      render(h(SettingsOverlay, {
        view: "robot-wrangler",
        validViews: buildValidViews(null),
        onNavigate: () => {},
        onClose: () => {},
        children: null,
      }), root);
    });
    await settle();

    expect(root.textContent).not.toContain("{cli}");
    expect(root.textContent).not.toMatch(/\bndx\b/);
  });

  it("breadcrumb for a settings view never shows an unresolved placeholder or a bare ndx", async () => {
    stubProject("myapp");
    act(() => {
      render(h(Breadcrumb, { view: "project", navigateTo: () => {} }), root);
    });
    await settle();
    expect(root.textContent).toContain("Project");
    expect(root.textContent).not.toContain("{cli}");
    expect(root.textContent).not.toMatch(/\bndx\b/);
  });

  it("Project page names the analyze and plan commands with the resolved name", async () => {
    stubProject("myapp", { otherApisFail: true });
    act(() => {
      render(h(ProjectView, null), root);
    });
    await settle();
    expect(root.querySelector(".project-header-subtitle")!.textContent).toContain("myapp analyze");
    expect(root.querySelector(".project-header-subtitle")!.textContent).toContain("myapp plan");
    expect(root.textContent).not.toMatch(/\bndx\b/);
  });

  it("Workflow page names the work command with the resolved name", async () => {
    stubProject("myapp", { otherApisFail: true });
    act(() => {
      render(h(WorkflowView, { navigateTo: () => {} }), root);
    });
    await settle();
    expect(root.querySelector(".workflow-header-subtitle")!.textContent).toContain("myapp work");
    expect(root.textContent).not.toMatch(/\bndx\b/);
  });

  it("falls back to n-dx when the project has no cli.name", async () => {
    stubProject(undefined);
    act(() => {
      render(h(SettingsOverlay, {
        view: "robot-wrangler",
        validViews: buildValidViews(null),
        onNavigate: () => {},
        onClose: () => {},
        children: null,
      }), root);
    });
    await settle();
    expect(root.textContent).not.toContain("{cli}");
  });
});

describe("no new hardcoded command prefixes in the viewer", () => {
  /**
   * Guard against regrowth: a bare `ndx <subcommand>` in viewer source is a
   * command reference that will be wrong for any project using a different
   * binary name. Use useCliName()/resolveCliLabel() instead.
   */
  it("viewer source contains no bare 'ndx <command>' strings", () => {
    const viewerRoot = join(import.meta.dirname, "../../../src/viewer");
    const offenders: string[] = [];

    function walk(dir: string): void {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        if (!entry.endsWith(".ts")) continue;
        const lines = readFileSync(full, "utf-8").split("\n");
        lines.forEach((line, i) => {
          const code = line.trim();
          // Skip comments and the n-dx product name (which is not a command).
          if (code.startsWith("//") || code.startsWith("*") || code.startsWith("/*")) return;
          const stripped = code.replace(/n-dx/g, "").replace(/ndx-deployed/g, "");
          if (/\bndx [a-z]/.test(stripped)) {
            offenders.push(`${full.split("/src/")[1]}:${i + 1}: ${code.slice(0, 90)}`);
          }
        });
      }
    }
    walk(viewerRoot);

    expect(
      offenders,
      `Hardcoded CLI command references found. Use useCliName() (components) or a "{cli}" template with resolveCliLabel() (constant tables):\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});
