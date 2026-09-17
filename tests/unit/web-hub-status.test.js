/**
 * What `ndx start status`, `ndx hub status` and `ndx start stop` print when a
 * directory is served through the hub.
 *
 * The three formatters are pure — they take the marker file and the hub's
 * answers and return lines — so the wording, and the cases where the hub or
 * the project is missing, are pinned here without a hub or a socket.
 */

import { describe, it, expect } from "vitest";
import {
  formatHubOverview,
  formatHubStatus,
  formatUnregister,
  formatUptime,
} from "../../packages/core/web.js";

const NOW = Date.parse("2026-09-16T12:00:00.000Z");
const MARKER = { pid: 4242, port: 3117, projectId: "alpha-app", via: "hub" };

function health(overrides = {}) {
  return {
    status: 200,
    body: {
      ok: true,
      pid: 4242,
      port: 3117,
      startedAt: "2026-09-16T09:47:00.000Z",
      registryPath: "/home/dev/.n-dx/hub.json",
      projects: 2,
      ...overrides,
    },
  };
}

function project(overrides = {}) {
  return {
    status: 200,
    body: {
      project: {
        id: "alpha-app",
        name: "Alpha App",
        repoRoot: "/repos/alpha",
        worktrees: ["/repos/alpha", "/repos/alpha/.wt/feature"],
        status: { state: "healthy", pid: 5678, port: 51234, attached: false, respawns: 0, lastHealthAt: null, lastError: null },
        ...overrides,
      },
    },
  };
}

describe("formatUptime", () => {
  it("scales from seconds to days and never invents precision", () => {
    expect(formatUptime(9_000)).toBe("9s");
    expect(formatUptime(62_000)).toBe("1m 02s");
    expect(formatUptime(8_040_000)).toBe("2h 14m");
    expect(formatUptime(270_000_000)).toBe("3d 3h");
  });

  it("says so rather than guessing when the duration is not a number", () => {
    expect(formatUptime(NaN)).toBe("unknown");
    expect(formatUptime(-1)).toBe("unknown");
  });
});

describe("formatHubStatus", () => {
  it("names the hub, the project, its server, its worktrees and the URL", () => {
    const lines = formatHubStatus({ label: "n-dx server", marker: MARKER, health: health(), project: project(), now: NOW });
    const text = lines.join("\n");

    expect(lines[0]).toBe("n-dx server: served through the n-dx hub.");
    expect(text).toContain("Hub:        PID 4242, port 3117, up 2h 13m");
    expect(text).toContain('Project:    "alpha-app" is healthy (server PID 5678, port 51234)');
    expect(text).toContain("Repository: /repos/alpha");
    expect(text).toContain("Worktrees:  2 registered");
    expect(text).toContain("    /repos/alpha/.wt/feature");
    expect(text).toContain("URL: http://localhost:3117/p/alpha-app/");
    expect(text).toContain("MCP (rex):          http://localhost:3117/p/alpha-app/mcp/rex");
    expect(text).toContain("MCP (sourcevision): http://localhost:3117/p/alpha-app/mcp/sourcevision");
  });

  it("carries the failure reason for a project whose server is not up", () => {
    const stopped = project({ status: { state: "unreachable", pid: null, port: null, attached: false, respawns: 1, lastHealthAt: null, lastError: "spawn ENOENT" } });
    const text = formatHubStatus({ label: "n-dx server", marker: MARKER, health: health(), project: stopped, now: NOW }).join("\n");
    expect(text).toContain('Project:    "alpha-app" is unreachable (spawn ENOENT)');
  });

  it("says the hub is not answering rather than reporting a project it could not ask about", () => {
    const lines = formatHubStatus({
      label: "n-dx server",
      marker: MARKER,
      health: { status: 0, body: null },
      project: { status: 0, body: null },
      now: NOW,
    });
    expect(lines[0]).toContain("registered with the n-dx hub on port 3117, but the hub is not answering");
    expect(lines.join("\n")).toContain("ndx start .");
    expect(lines.join("\n")).not.toContain("URL:");
  });

  it("distinguishes a live hub that has never heard of this project — a stale marker", () => {
    const lines = formatHubStatus({
      label: "n-dx server",
      marker: MARKER,
      health: health(),
      project: { status: 404, body: { error: "No project registered as \"alpha-app\"" } },
      now: NOW,
    });
    const text = lines.join("\n");
    expect(text).toContain("the n-dx hub is running (PID 4242, port 3117, up 2h 13m)");
    expect(text).toContain('but no project "alpha-app" is registered');
  });

  it("omits the uptime rather than printing a bogus one when the hub did not say", () => {
    const text = formatHubStatus({ label: "n-dx server", marker: MARKER, health: health({ startedAt: undefined }), project: project(), now: NOW }).join("\n");
    expect(text).toContain("Hub:        PID 4242, port 3117\n");
    expect(text).not.toContain("up ");
  });
});

describe("formatHubOverview", () => {
  it("lists the hub and every project with its state, port and root", () => {
    const projects = {
      status: 200,
      body: {
        projects: [
          { id: "alpha-app", repoRoot: "/repos/alpha", status: { state: "healthy", port: 51234 } },
          { id: "b", repoRoot: "/repos/b", status: { state: "stopped", port: null } },
        ],
      },
    };
    const text = formatHubOverview({ port: 3117, health: health(), projects, now: NOW }).join("\n");
    expect(text).toContain("n-dx hub: running (PID 4242, port 3117, up 2h 13m).");
    expect(text).toContain("Registry: /home/dev/.n-dx/hub.json");
    expect(text).toContain("Projects (2):");
    expect(text).toContain("alpha-app  healthy     port 51234  /repos/alpha");
    // A project with no server has a dash where the port goes, not "port null".
    expect(text).toContain("b          stopped     —           /repos/b");
  });

  it("says so when the hub is up with nothing registered", () => {
    const text = formatHubOverview({ port: 3117, health: health({ projects: 0 }), projects: { status: 200, body: { projects: [] } }, now: NOW }).join("\n");
    expect(text).toContain("No projects registered.");
  });

  it("says the hub is not running, and how to start one", () => {
    const lines = formatHubOverview({ port: 3117, health: { status: 0, body: null }, projects: { status: 0, body: null }, now: NOW });
    expect(lines[0]).toBe("n-dx hub: not running (nothing answers on port 3117).");
    expect(lines[1]).toContain("ndx start .");
  });
});

describe("formatUnregister", () => {
  const base = { label: "n-dx server", projectId: "alpha-app", port: 3117, worktree: "/repos/alpha/.wt/feature" };

  it("reports the project still served, and by which worktrees", () => {
    const text = formatUnregister({
      ...base,
      result: { projectRemoved: false, worktreeKnown: true, remaining: ["/repos/alpha"], hubExiting: false },
    }).join("\n");
    expect(text).toContain('unregistered /repos/alpha/.wt/feature from project "alpha-app"');
    expect(text).toContain("Still served for 1 worktree(s) at http://localhost:3117/p/alpha-app/");
    expect(text).toContain("    /repos/alpha");
  });

  it("reports the project and its server gone when that was the last worktree", () => {
    const lines = formatUnregister({
      ...base,
      result: { projectRemoved: true, worktreeKnown: true, remaining: [], hubExiting: false },
    });
    expect(lines).toEqual(['n-dx server: unregistered "alpha-app" from the n-dx hub and stopped its server.']);
  });

  it("adds the hub's own exit when nothing is left to serve", () => {
    const text = formatUnregister({
      ...base,
      result: { projectRemoved: true, worktreeKnown: true, remaining: [], hubExiting: true },
    }).join("\n");
    expect(text).toContain("That was the hub's last project, so the hub exited too.");
  });

  it("does not claim to have removed a worktree the hub never had", () => {
    const text = formatUnregister({
      ...base,
      result: { projectRemoved: false, worktreeKnown: false, remaining: ["/repos/alpha"], hubExiting: false },
    }).join("\n");
    expect(text).toContain("this worktree was not registered with the n-dx hub");
    expect(text).toContain('project "alpha-app" is untouched');
  });
});
