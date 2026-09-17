import { describe, it, expect, vi } from "vitest";
import { WorkspaceScoped, workspaceKeyOf } from "../../../src/server/workspace-scoped.js";

const ctx = (projectDir: string, workspace?: string) => ({ projectDir, workspace });

describe("workspaceKeyOf", () => {
  it("prefers the workspace key and falls back to the project directory", () => {
    expect(workspaceKeyOf(ctx("/repo", "feature"))).toBe("feature");
    expect(workspaceKeyOf(ctx("/repo"))).toBe("/repo");
  });
});

describe("WorkspaceScoped", () => {
  it("creates one value per key, lazily, and hands the same value back", () => {
    const create = vi.fn((key: string) => ({ key, n: 0 }));
    const scoped = new WorkspaceScoped(create);
    expect(scoped.size).toBe(0);

    const a = scoped.get(ctx("/a", "a"));
    a.n++;
    expect(scoped.get(ctx("/a", "a"))).toBe(a);
    expect(scoped.get(ctx("/anything", "a")).n).toBe(1);
    expect(create).toHaveBeenCalledTimes(1);

    const b = scoped.get(ctx("/b"));
    expect(b).not.toBe(a);
    expect(b.key).toBe("/b");
    expect(scoped.size).toBe(2);
  });

  it("peek never creates; delete and clear release values", () => {
    const scoped = new WorkspaceScoped(() => ({}));
    expect(scoped.peek(ctx("/x", "x"))).toBeUndefined();
    scoped.get(ctx("/x", "x"));
    scoped.get(ctx("/y", "y"));
    expect(scoped.peek(ctx("/x", "x"))).toBeDefined();
    expect(scoped.delete(ctx("/x", "x"))).toBe(true);
    expect(Array.from(scoped.entries()).map(([k]) => k)).toEqual(["y"]);
    scoped.clear();
    expect(scoped.size).toBe(0);
  });
});
