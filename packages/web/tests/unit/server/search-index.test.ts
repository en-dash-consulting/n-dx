import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SearchIndex, parseQuery } from "../../../src/server/search-index.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makePrd(items: unknown[]) {
  return { schema: "rex/v1", title: "Test", items };
}

function makeItem(overrides: Record<string, unknown> = {}) {
  return {
    id: overrides.id ?? "item-1",
    title: overrides.title ?? "Test item",
    status: overrides.status ?? "pending",
    level: overrides.level ?? "task",
    ...overrides,
  };
}

// ── parseQuery tests ─────────────────────────────────────────────────────────

describe("parseQuery", () => {
  it("parses simple single-word queries", () => {
    const result = parseQuery("authentication");
    expect(result.terms).toEqual(["authentication"]);
    expect(result.phrases).toEqual([]);
    expect(result.isOr).toBe(false);
  });

  it("parses multi-word queries as AND by default", () => {
    const result = parseQuery("user authentication");
    expect(result.terms).toEqual(["user", "authentication"]);
    expect(result.isOr).toBe(false);
  });

  it("detects OR logic", () => {
    const result = parseQuery("user OR authentication");
    expect(result.terms).toContain("user");
    expect(result.terms).toContain("authentication");
    expect(result.isOr).toBe(true);
  });

  it("extracts quoted phrases", () => {
    const result = parseQuery('"exact phrase" other');
    expect(result.phrases).toEqual(["exact phrase"]);
    expect(result.terms).toEqual(["other"]);
  });

  it("handles multiple quoted phrases", () => {
    const result = parseQuery('"search engine" "full text"');
    expect(result.phrases).toEqual(["search engine", "full text"]);
  });

  it("removes stop words from terms", () => {
    const result = parseQuery("the user and authentication");
    expect(result.terms).not.toContain("the");
    expect(result.terms).not.toContain("and");
    expect(result.terms).toContain("user");
    expect(result.terms).toContain("authentication");
  });

  it("handles empty query", () => {
    const result = parseQuery("");
    expect(result.terms).toEqual([]);
    expect(result.phrases).toEqual([]);
  });

  it("handles query with only stop words", () => {
    const result = parseQuery("the a an");
    expect(result.terms).toEqual([]);
  });
});

// ── SearchIndex tests ────────────────────────────────────────────────────────

describe("SearchIndex", () => {
  let tmpDir: string;
  let rexDir: string;
  let index: SearchIndex;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "search-index-"));
    rexDir = join(tmpDir, ".n-dx/rex");
    await mkdir(rexDir, { recursive: true });
    index = new SearchIndex(rexDir);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  // ── Basic indexing ─────────────────────────────────────────────────────

  it("indexes items from PRD file", async () => {
    const prd = makePrd([
      makeItem({ id: "1", title: "User authentication" }),
      makeItem({ id: "2", title: "Database schema" }),
    ]);
    await writeFile(join(rexDir, "prd.json"), JSON.stringify(prd));

    const count = index.rebuild();
    expect(count).toBe(2);
    expect(index.size).toBe(2);
  });

  it("indexes nested items (children)", async () => {
    const prd = makePrd([
      makeItem({
        id: "epic-1",
        title: "Auth epic",
        level: "epic",
        children: [
          makeItem({
            id: "feature-1",
            title: "Login feature",
            level: "feature",
            children: [
              makeItem({ id: "task-1", title: "Implement login form", level: "task" }),
            ],
          }),
        ],
      }),
    ]);
    await writeFile(join(rexDir, "prd.json"), JSON.stringify(prd));

    const count = index.rebuild();
    expect(count).toBe(3); // epic + feature + task
  });

  it("returns empty results when no PRD file exists", () => {
    const results = index.search("anything");
    expect(results).toEqual([]);
  });

  it("returns empty results for empty query", async () => {
    const prd = makePrd([makeItem({ id: "1", title: "Test" })]);
    await writeFile(join(rexDir, "prd.json"), JSON.stringify(prd));

    const results = index.search("");
    expect(results).toEqual([]);
  });

  // ── Basic search ───────────────────────────────────────────────────────

  it("finds items by title match", async () => {
    const prd = makePrd([
      makeItem({ id: "1", title: "User authentication system" }),
      makeItem({ id: "2", title: "Database migration" }),
    ]);
    await writeFile(join(rexDir, "prd.json"), JSON.stringify(prd));

    const results = index.search("authentication");
    expect(results.length).toBe(1);
    expect(results[0].id).toBe("1");
    expect(results[0].matchedFields).toContain("title");
  });

  it("finds items by description match", async () => {
    const prd = makePrd([
      makeItem({
        id: "1",
        title: "Setup",
        description: "Configure the authentication middleware",
      }),
    ]);
    await writeFile(join(rexDir, "prd.json"), JSON.stringify(prd));

    const results = index.search("authentication");
    expect(results.length).toBe(1);
    expect(results[0].id).toBe("1");
    expect(results[0].matchedFields).toContain("description");
  });

  it("finds items by acceptance criteria match", async () => {
    const prd = makePrd([
      makeItem({
        id: "1",
        title: "Setup",
        acceptanceCriteria: ["Users can authenticate with OAuth"],
      }),
    ]);
    await writeFile(join(rexDir, "prd.json"), JSON.stringify(prd));

    const results = index.search("oauth");
    expect(results.length).toBe(1);
    expect(results[0].id).toBe("1");
    expect(results[0].matchedFields).toContain("acceptanceCriteria");
  });

  it("finds items by tag match", async () => {
    const prd = makePrd([
      makeItem({ id: "1", title: "Setup", tags: ["authentication", "security"] }),
      makeItem({ id: "2", title: "Other" }),
    ]);
    await writeFile(join(rexDir, "prd.json"), JSON.stringify(prd));

    const results = index.search("security");
    expect(results.length).toBe(1);
    expect(results[0].id).toBe("1");
    expect(results[0].matchedFields).toContain("tags");
  });

  // ── Relevance scoring ──────────────────────────────────────────────────

  it("ranks title matches higher than description matches", async () => {
    const prd = makePrd([
      makeItem({
        id: "desc-match",
        title: "Some other title",
        description: "Uses authentication for login",
      }),
      makeItem({
        id: "title-match",
        title: "Authentication system",
        description: "Handles user access",
      }),
    ]);
    await writeFile(join(rexDir, "prd.json"), JSON.stringify(prd));

    const results = index.search("authentication");
    expect(results.length).toBe(2);
    expect(results[0].id).toBe("title-match");
    expect(results[0].score).toBeGreaterThan(results[1].score);
  });

  it("returns results sorted by relevance score descending", async () => {
    const prd = makePrd([
      makeItem({
        id: "low",
        title: "Other task",
        description: "Uses search for lookup",
      }),
      makeItem({
        id: "high",
        title: "Search endpoint",
        description: "Implements search functionality",
        tags: ["search"],
      }),
      makeItem({
        id: "mid",
        title: "Search helper",
      }),
    ]);
    await writeFile(join(rexDir, "prd.json"), JSON.stringify(prd));

    const results = index.search("search");
    expect(results.length).toBe(3);
    // "high" has matches in title + description + tags
    expect(results[0].id).toBe("high");
    // Scores should be descending
    for (let i = 1; i < results.length; i++) {
      expect(results[i].score).toBeLessThanOrEqual(results[i - 1].score);
    }
  });

  // ── Result shape ───────────────────────────────────────────────────────

  it("includes all required fields in results", async () => {
    const prd = makePrd([
      makeItem({
        id: "task-1",
        title: "Authentication system",
        description: "Build auth",
        level: "task",
        status: "pending",
      }),
    ]);
    await writeFile(join(rexDir, "prd.json"), JSON.stringify(prd));

    const results = index.search("authentication");
    expect(results.length).toBe(1);
    const r = results[0];
    expect(r.id).toBe("task-1");
    expect(r.title).toBe("Authentication system");
    expect(r.description).toBe("Build auth");
    expect(r.level).toBe("task");
    expect(r.status).toBe("pending");
    expect(typeof r.score).toBe("number");
    expect(r.score).toBeGreaterThan(0);
    expect(Array.isArray(r.matchedFields)).toBe(true);
    expect(Array.isArray(r.parentChain)).toBe(true);
  });

  it("includes parent chain in results", async () => {
    const prd = makePrd([
      makeItem({
        id: "epic-1",
        title: "Auth Epic",
        level: "epic",
        children: [
          makeItem({
            id: "feature-1",
            title: "Login Feature",
            level: "feature",
            children: [
              makeItem({ id: "task-1", title: "Login form implementation", level: "task" }),
            ],
          }),
        ],
      }),
    ]);
    await writeFile(join(rexDir, "prd.json"), JSON.stringify(prd));

    const results = index.search("login");
    const task = results.find((r) => r.id === "task-1");
    expect(task).toBeDefined();
    expect(task!.parentChain).toEqual(["Auth Epic", "Login Feature"]);
  });

  it("returns null for description when item has no description", async () => {
    const prd = makePrd([makeItem({ id: "1", title: "Authentication" })]);
    await writeFile(join(rexDir, "prd.json"), JSON.stringify(prd));

    const results = index.search("authentication");
    expect(results[0].description).toBeNull();
  });

  // ── All levels ─────────────────────────────────────────────────────────

  it("searches across all item levels", async () => {
    const prd = makePrd([
      makeItem({
        id: "epic-1",
        title: "Search epic",
        level: "epic",
        children: [
          makeItem({
            id: "feature-1",
            title: "Search feature",
            level: "feature",
            children: [
              makeItem({
                id: "task-1",
                title: "Search task",
                level: "task",
                children: [
                  makeItem({ id: "subtask-1", title: "Search subtask", level: "subtask" }),
                ],
              }),
            ],
          }),
        ],
      }),
    ]);
    await writeFile(join(rexDir, "prd.json"), JSON.stringify(prd));

    const results = index.search("search");
    expect(results.length).toBe(4);
    const levels = results.map((r) => r.level);
    expect(levels).toContain("epic");
    expect(levels).toContain("feature");
    expect(levels).toContain("task");
    expect(levels).toContain("subtask");
  });

  // ── Partial / fuzzy matching ───────────────────────────────────────────

  it("supports prefix matching", async () => {
    const prd = makePrd([
      makeItem({ id: "1", title: "Authentication system" }),
    ]);
    await writeFile(join(rexDir, "prd.json"), JSON.stringify(prd));

    // "auth" should match "authentication" via prefix
    const results = index.search("auth");
    expect(results.length).toBe(1);
    expect(results[0].id).toBe("1");
  });

  it("supports substring matching for longer terms", async () => {
    const prd = makePrd([
      makeItem({ id: "1", title: "Reauthentication flow" }),
    ]);
    await writeFile(join(rexDir, "prd.json"), JSON.stringify(prd));

    // "auth" should match "reauthentication" via substring
    const results = index.search("auth");
    expect(results.length).toBe(1);
  });

  // ── Exact phrase matching ──────────────────────────────────────────────

  it("supports exact phrase matching with quotes", async () => {
    const prd = makePrd([
      makeItem({ id: "1", title: "Build user authentication system" }),
      makeItem({ id: "2", title: "User profile system with authentication" }),
    ]);
    await writeFile(join(rexDir, "prd.json"), JSON.stringify(prd));

    // Exact phrase "user authentication" should match item 1 but not item 2
    const results = index.search('"user authentication"');
    expect(results.length).toBe(1);
    expect(results[0].id).toBe("1");
  });

  // ── Multi-word AND logic ───────────────────────────────────────────────

  it("applies AND logic for multi-word queries by default", async () => {
    const prd = makePrd([
      makeItem({ id: "1", title: "User authentication system" }),
      makeItem({ id: "2", title: "User profile page" }),
      makeItem({ id: "3", title: "Authentication middleware" }),
    ]);
    await writeFile(join(rexDir, "prd.json"), JSON.stringify(prd));

    // "user authentication" with AND should only match item 1
    const results = index.search("user authentication");
    expect(results.length).toBe(1);
    expect(results[0].id).toBe("1");
  });

  // ── Multi-word OR logic ────────────────────────────────────────────────

  it("applies OR logic when OR keyword is present", async () => {
    const prd = makePrd([
      makeItem({ id: "1", title: "User authentication system" }),
      makeItem({ id: "2", title: "User profile page" }),
      makeItem({ id: "3", title: "Authentication middleware" }),
      makeItem({ id: "4", title: "Database migration" }),
    ]);
    await writeFile(join(rexDir, "prd.json"), JSON.stringify(prd));

    // "user OR authentication" should match items 1, 2, 3
    const results = index.search("user OR authentication");
    expect(results.length).toBe(3);
    const ids = results.map((r) => r.id);
    expect(ids).toContain("1");
    expect(ids).toContain("2");
    expect(ids).toContain("3");
    expect(ids).not.toContain("4");
  });

  // ── Auto-update on PRD changes ─────────────────────────────────────────

  it("auto-updates index when PRD file changes", async () => {
    // Initial PRD
    const prd1 = makePrd([makeItem({ id: "1", title: "Original item" })]);
    await writeFile(join(rexDir, "prd.json"), JSON.stringify(prd1));

    const results1 = index.search("original");
    expect(results1.length).toBe(1);

    // Wait a tick so mtime changes
    await new Promise((r) => setTimeout(r, 50));

    // Update PRD
    const prd2 = makePrd([
      makeItem({ id: "1", title: "Original item" }),
      makeItem({ id: "2", title: "New item" }),
    ]);
    await writeFile(join(rexDir, "prd.json"), JSON.stringify(prd2));

    // Index should detect the change and rebuild
    const results2 = index.search("new");
    expect(results2.length).toBe(1);
    expect(results2[0].id).toBe("2");
  });

  // ── Invalidation ───────────────────────────────────────────────────────

  it("invalidate() forces rebuild on next search", async () => {
    const prd = makePrd([makeItem({ id: "1", title: "Test item" })]);
    await writeFile(join(rexDir, "prd.json"), JSON.stringify(prd));

    // Build index
    index.rebuild();
    expect(index.size).toBe(1);

    // Invalidate
    index.invalidate();

    // Next search should trigger rebuild
    const results = index.search("test");
    expect(results.length).toBe(1);
  });

  // ── Limit ──────────────────────────────────────────────────────────────

  it("respects the limit parameter", async () => {
    const items = Array.from({ length: 20 }, (_, i) =>
      makeItem({ id: `item-${i}`, title: `Search result number ${i}` }),
    );
    const prd = makePrd(items);
    await writeFile(join(rexDir, "prd.json"), JSON.stringify(prd));

    const results = index.search("search", 5);
    expect(results.length).toBe(5);
  });

  // ── Performance ────────────────────────────────────────────────────────

  it("handles large PRDs efficiently (1000+ items)", async () => {
    const items = Array.from({ length: 1000 }, (_, i) =>
      makeItem({
        id: `item-${i}`,
        title: `Task ${i}: implement feature ${i % 10 === 0 ? "authentication" : "module"} part ${i}`,
        description: `Description for task ${i} with various keywords like search, index, query`,
        acceptanceCriteria: [`Criteria ${i} must pass`, `Performance must be under 200ms`],
        tags: i % 5 === 0 ? ["search", "performance"] : ["general"],
      }),
    );
    const prd = makePrd(items);
    await writeFile(join(rexDir, "prd.json"), JSON.stringify(prd));

    // Rebuild should be fast
    const rebuildStart = performance.now();
    const count = index.rebuild();
    const rebuildElapsed = performance.now() - rebuildStart;
    expect(count).toBe(1000);
    expect(rebuildElapsed).toBeLessThan(5000); // Under 5 seconds

    // Search should be fast
    const searchStart = performance.now();
    const results = index.search("authentication");
    const searchElapsed = performance.now() - searchStart;
    expect(results.length).toBeGreaterThan(0);
    expect(searchElapsed).toBeLessThan(200); // Under 200ms
  });

  // ── Edge cases ─────────────────────────────────────────────────────────

  it("handles malformed PRD file gracefully", async () => {
    await writeFile(join(rexDir, "prd.json"), "not valid json {{{");

    const results = index.search("test");
    expect(results).toEqual([]);
  });

  it("handles items with no optional fields", async () => {
    const prd = makePrd([
      { id: "1", title: "Minimal", status: "pending", level: "task" },
    ]);
    await writeFile(join(rexDir, "prd.json"), JSON.stringify(prd));

    const results = index.search("minimal");
    expect(results.length).toBe(1);
    expect(results[0].description).toBeNull();
  });

  it("case insensitive search", async () => {
    const prd = makePrd([
      makeItem({ id: "1", title: "Authentication System" }),
    ]);
    await writeFile(join(rexDir, "prd.json"), JSON.stringify(prd));

    const results = index.search("AUTHENTICATION");
    expect(results.length).toBe(1);
  });
});
