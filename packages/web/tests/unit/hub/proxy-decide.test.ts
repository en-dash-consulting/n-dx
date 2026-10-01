/**
 * `decideProxy`'s routing rules, which are pure over the hub's project list.
 *
 * The case that needs stating is `/hub`. `/` is overloaded — it is the sole
 * project's dashboard with one registered and the chooser with several — so
 * the dashboard has no root-level address it can link back to. `/hub` is that
 * address, and it has to answer the same way at every project count, which is
 * exactly what a list-dependent rule would get wrong.
 */

import { describe, it, expect } from "vitest";
import { HUB_PATH } from "../../../src/shared/index.js";
import { decideProxy } from "../../../src/hub/index.js";
import type { Hub, ProjectView } from "../../../src/hub/index.js";

function view(id: string): ProjectView {
  return {
    id, name: id, repoRoot: `/repo/${id}`, worktrees: [`/repo/${id}`], ndxBin: "/x.js",
    port: 4000, pid: 1, lastSeen: null,
    status: { state: "healthy", pid: 1, port: 4000, attached: false, respawns: 0, lastHealthAt: null, lastError: null },
  };
}

/** Only the two members `decideProxy` reads. */
function hubWith(...projects: ProjectView[]): Hub {
  return {
    listProjects: () => projects,
    getProject: (id: string) => projects.find((p) => p.id === id),
  } as unknown as Hub;
}

const none = hubWith();
const one = hubWith(view("alpha"));
const several = hubWith(view("alpha"), view("beta"));

describe("decideProxy: the hub chooser at /hub", () => {
  it("answers with the chooser at every project count", () => {
    for (const hub of [none, one, several]) {
      expect(decideProxy(hub, HUB_PATH).kind).toBe("home");
      expect(decideProxy(hub, `${HUB_PATH}/`).kind).toBe("home");
    }
  });

  it("still opens the sole project at /, so the alias is untouched", () => {
    const decision = decideProxy(one, "/");
    expect(decision).toMatchObject({ kind: "proxy", path: "/", prefix: "" });
    // And the existing root behaviour at the other two counts.
    expect(decideProxy(none, "/").kind).toBe("home");
    expect(decideProxy(several, "/").kind).toBe("home");
    expect(decideProxy(several, "/api/status")).toMatchObject({ kind: "json", status: 409 });
  });

  it("leaves a project's own /hub path to that project", () => {
    expect(decideProxy(one, "/p/alpha/hub")).toMatchObject({ kind: "proxy", path: "/hub", prefix: "/p/alpha" });
    // Under the single-project root alias too: only the exact path is the hub's.
    expect(decideProxy(one, "/hub/extra")).toMatchObject({ kind: "proxy", path: "/hub/extra" });
  });

  it("refuses a WebSocket upgrade at the chooser rather than forwarding it", () => {
    // There is no socket on a page the hub renders itself; with one project
    // registered the fall-through would otherwise hand it to that project.
    expect(decideProxy(one, HUB_PATH, true)).toMatchObject({ kind: "json", status: 404 });
    expect(decideProxy(several, HUB_PATH, true)).toMatchObject({ kind: "json", status: 404 });
  });
});
