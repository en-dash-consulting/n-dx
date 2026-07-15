/**
 * Unit tests for LiveAsanaClient — the HTTP layer.
 *
 * Verifies the request contract (method, path, headers, body shape) against
 * the Asana REST API by stubbing global fetch. Mirrors notion-client.test.ts.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { LiveAsanaClient } from "../../../src/store/asana-client.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe("LiveAsanaClient", () => {
  let client: LiveAsanaClient;

  beforeEach(() => {
    client = new LiveAsanaClient("1/token-abc");
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends a Bearer token and JSON content-type", async () => {
    (fetch as any).mockResolvedValueOnce(jsonResponse({ data: {} }));
    await client.createTask({ name: "T", projects: ["1"] });

    const [, init] = (fetch as any).mock.calls[0];
    expect(init.headers.Authorization).toBe("Bearer 1/token-abc");
    expect(init.headers["Content-Type"]).toBe("application/json");
  });

  it("creates a task with a data envelope", async () => {
    (fetch as any).mockResolvedValueOnce(
      jsonResponse({ data: { gid: "99", name: "T" } }),
    );
    const task = await client.createTask({
      name: "T",
      notes: "body",
      completed: false,
      projects: ["proj-1"],
      external: { gid: "prd-1", data: "{}" },
    });

    const [url, init] = (fetch as any).mock.calls[0];
    expect(init.method).toBe("POST");
    expect(url).toContain("/tasks");
    expect(JSON.parse(init.body)).toEqual({
      data: {
        name: "T",
        notes: "body",
        completed: false,
        projects: ["proj-1"],
        external: { gid: "prd-1", data: "{}" },
      },
    });
    expect(task.gid).toBe("99");
  });

  it("updates a task with PUT", async () => {
    (fetch as any).mockResolvedValueOnce(jsonResponse({ data: { gid: "99" } }));
    await client.updateTask("99", { name: "Renamed", completed: true });

    const [url, init] = (fetch as any).mock.calls[0];
    expect(init.method).toBe("PUT");
    expect(url).toContain("/tasks/99");
    expect(JSON.parse(init.body)).toEqual({
      data: { name: "Renamed", completed: true },
    });
  });

  it("deletes a task with DELETE", async () => {
    (fetch as any).mockResolvedValueOnce(jsonResponse(undefined, 200));
    await client.deleteTask("99");

    const [url, init] = (fetch as any).mock.calls[0];
    expect(init.method).toBe("DELETE");
    expect(url).toContain("/tasks/99");
    expect(init.body).toBeUndefined();
  });

  it("lists project tasks and descends into subtasks", async () => {
    // 1) project tasks, 2) subtasks of parent, 3) subtasks of child (empty)
    (fetch as any)
      .mockResolvedValueOnce(jsonResponse({ data: [{ gid: "p1", name: "Parent" }] }))
      .mockResolvedValueOnce(jsonResponse({ data: [{ gid: "c1", name: "Child", parent: { gid: "p1" } }] }))
      .mockResolvedValueOnce(jsonResponse({ data: [] }));

    const tasks = await client.listTasks("proj-1");

    expect(tasks.map((t) => t.gid)).toEqual(["p1", "c1"]);
    const firstUrl = (fetch as any).mock.calls[0][0];
    expect(firstUrl).toContain("/projects/proj-1/tasks");
    expect(firstUrl).toContain("opt_fields=");
  });

  it("follows pagination cursors", async () => {
    (fetch as any)
      .mockResolvedValueOnce(
        jsonResponse({ data: [{ gid: "p1", name: "A" }], next_page: { offset: "abc" } }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: [{ gid: "p2", name: "B" }] }))
      // subtasks for p1 and p2
      .mockResolvedValueOnce(jsonResponse({ data: [] }))
      .mockResolvedValueOnce(jsonResponse({ data: [] }));

    const tasks = await client.listTasks("proj-1");
    expect(tasks.map((t) => t.gid)).toEqual(["p1", "p2"]);
    expect((fetch as any).mock.calls[1][0]).toContain("offset=abc");
  });

  it("throws with status and body on a non-ok response", async () => {
    (fetch as any).mockResolvedValueOnce(jsonResponse({ errors: ["nope"] }, 401));
    await expect(client.createTask({ name: "T" })).rejects.toThrow(/401/);
  });
});
/* eslint-enable @typescript-eslint/no-explicit-any */
