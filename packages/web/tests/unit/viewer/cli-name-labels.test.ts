// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { Sidebar } from "../../../src/viewer/components/sidebar.js";
import { Breadcrumb } from "../../../src/viewer/components/breadcrumb.js";
import { resolveCliLabel, clearProjectMetadataCache } from "../../../src/viewer/hooks/use-project-metadata.js";

function stubProject(cliName?: string) {
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
    return { ok: true, status: 200, json: async () => ({}) };
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

  it("sidebar renders the resolved name, never a bare ndx", async () => {
    stubProject("myapp");
    act(() => {
      render(h(Sidebar, {
        view: "overview" as never,
        onNavigate: () => {},
        manifest: null,
        zones: null,
        sidebarCollapsed: false,
        onToggleSidebar: () => {},
      }), root);
    });
    await settle();

    expect(root.textContent).toContain("myapp work");
    expect(root.textContent).toContain("myapp analyze / plan");
    expect(root.textContent).not.toContain("{cli}");
    expect(root.textContent).not.toMatch(/\bndx\b/);
  });

  it("breadcrumb renders the resolved name for a settings view", async () => {
    stubProject("myapp");
    act(() => {
      render(h(Breadcrumb, { view: "hench-config" as never, navigateTo: () => {} }), root);
    });
    await settle();
    expect(root.textContent).toContain("myapp work");
    expect(root.textContent).not.toMatch(/\bndx\b/);
  });

  it("falls back to n-dx when the project has no cli.name", async () => {
    stubProject(undefined);
    act(() => {
      render(h(Sidebar, {
        view: "overview" as never,
        onNavigate: () => {},
        manifest: null,
        zones: null,
        sidebarCollapsed: false,
        onToggleSidebar: () => {},
      }), root);
    });
    await settle();
    expect(root.textContent).toContain("n-dx work");
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
