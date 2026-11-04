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
import { HUB_PATH, TICKET_QUERY_PARAM } from "../../../src/shared/index.js";
import { decideProxy } from "../../../src/hub/index.js";
import type { Hub, ProjectView } from "../../../src/hub/index.js";

function view(id: string): ProjectView {
  return {
    id, name: id, repoRoot: `/repo/${id}`, worktrees: [`/repo/${id}`], 
    port: 4000, pid: 1, lastSeen: null, ndxBin: "/hub/ndx.js",
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

describe("decideProxy: a sidecar never sees ndx_token in the query", () => {
  it("drops it for HTTP and for a WebSocket upgrade, keeping the other parameters", () => {
    for (const upgrade of [false, true]) {
      expect(decideProxy(one, "/x/recon/page?a=1&ndx_token=T&b=2", upgrade)).toMatchObject({ kind: "sidecar", path: "/page?a=1&b=2" });
      expect(decideProxy(one, "/x/recon/?ndx_token=T", upgrade)).toMatchObject({ kind: "sidecar", path: "/" });
    }
    expect(decideProxy(one, "/x/recon?ndx_token=T", true)).toMatchObject({ kind: "sidecar", path: "/" });
  });

  it("forwards every other segment byte for byte", () => {
    // URLSearchParams would rewrite each of these: %20 → +, bare key → c=,
    // / and ~ escaped, invalid UTF-8 %E9 → %EF%BF%BD.
    const rest = "a=%20b&c&path=/a/b~c&cb=%E9&d=x+y&&e=%2F";
    for (const upgrade of [false, true]) {
      expect(decideProxy(one, `/x/recon/page?${rest}&ndx_token=T`, upgrade)).toMatchObject({ kind: "sidecar", path: `/page?${rest}` });
      expect(decideProxy(one, `/x/recon/page?ndx_token=T&${rest}`, upgrade)).toMatchObject({ kind: "sidecar", path: `/page?${rest}` });
    }
  });

  it("drops an encoded or repeated ndx_token key too", () => {
    expect(decideProxy(one, "/x/recon/?a=1&ndx%5Ftoken=T&ndx_token=U")).toMatchObject({ kind: "sidecar", path: "/?a=1" });
  });

  it("drops it from the trailing-slash redirect", () => {
    expect(decideProxy(one, "/x/recon?q=2&ndx_token=T")).toEqual({ kind: "redirect", location: "/x/recon/?q=2" });
  });

  it("leaves a query without it untouched", () => {
    expect(decideProxy(one, "/x/recon/p?a=%20b&c")).toMatchObject({ kind: "sidecar", path: "/p?a=%20b&c" });
  });
});

describe("decideProxy: the hub session at /hub/session/", () => {
  it("maps to the host's /api/sidecar/hub/ routes at every project count, for HTTP and upgrades alike", () => {
    for (const hub of [none, one, several]) {
      for (const upgrade of [false, true]) {
        expect(decideProxy(hub, "/hub/session/sessions/s-1/turns", upgrade)).toEqual({ kind: "hub-session", path: "/api/sidecar/hub/sessions/s-1/turns" });
      }
      expect(decideProxy(hub, "/hub/session")).toEqual({ kind: "hub-session", path: "/api/sidecar/hub" });
    }
  });

  it("drops the token and ticket parameters and leaves the chooser and look-alikes alone", () => {
    expect(decideProxy(several, "/hub/session/sessions?ndx_token=T&a=1")).toEqual({ kind: "hub-session", path: "/api/sidecar/hub/sessions?a=1" });
    expect(decideProxy(several, `/hub/session/ws?a=1&${TICKET_QUERY_PARAM}=spent&b=2`, true)).toEqual({ kind: "hub-session", path: "/api/sidecar/hub/ws?a=1&b=2" });
    expect(decideProxy(several, `/hub/session/x?${TICKET_QUERY_PARAM}=spent&ndx_token=T`)).toEqual({ kind: "hub-session", path: "/api/sidecar/hub/x" });
    expect(decideProxy(several, "/hub/").kind).toBe("home");
    expect(decideProxy(several, "/hub/sessions").kind).not.toBe("hub-session");
    expect(decideProxy(several, "/p/alpha/hub/session/x")).toMatchObject({ kind: "proxy", path: "/hub/session/x" });
  });
});

describe("decideProxy: a sidecar under its mount key", () => {
  const one = hubWith(view("alpha"));
  const key = "k".repeat(32);

  it("strips the key with the mount, and names it for the gate to check", () => {
    expect(decideProxy(one, `/x/recon/~${key}/assets/a.js?v=1`)).toEqual({
      kind: "sidecar",
      name: "recon",
      path: "/assets/a.js?v=1",
      prefix: `/x/recon/~${key}`,
      mountKey: key,
    });
    expect(decideProxy(one, `/x/recon/~${key}`, true)).toMatchObject({ kind: "sidecar", path: "/", mountKey: key });
  });

  it("redirects the keyed mount without its slash to the keyed mount", () => {
    expect(decideProxy(one, `/x/recon/~${key}?a=1`)).toEqual({ kind: "redirect", location: `/x/recon/~${key}/?a=1` });
  });

  it("treats a short or odd `~` segment as an ordinary path of the app", () => {
    expect(decideProxy(one, "/x/recon/~short/a")).toMatchObject({ kind: "sidecar", path: "/~short/a", prefix: "/x/recon" });
  });
});
