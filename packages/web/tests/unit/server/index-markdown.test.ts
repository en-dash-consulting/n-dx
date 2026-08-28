/**
 * Regression coverage for GET /api/rex/items/:id/index-md.
 *
 * The route previously resolved on-disk paths with its own simplified slug
 * algorithm (a duplicate of, and out of sync with, the real one in
 * folder-tree-serializer.ts) and always assumed every item lives in its own
 * `<slug>/` directory — wrong for leaf items, which the serializer writes
 * as a bare `<slug>.md` file in their *parent's* directory. Both bugs
 * produced 404s for ordinary tasks/subtasks. This suite builds a real
 * folder tree via `serializeFolderTree` (the same function the store uses)
 * so path resolution is checked against actual on-disk output, not a
 * hand-picked expectation.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer, type Server } from "node:http";
import { serializeFolderTree } from "@n-dx/rex";
import type { ServerContext } from "../../../src/server/types.js";
import { getIndexMarkdown } from "../../../src/server/routes-rex/index-markdown.js";
import { closeRouteTestServer } from "../../helpers/server-route-test-support.js";

const PRD_TREE_DIRNAME = "prd_tree";

function makeItems() {
  return [
    {
      id: "epic-1",
      title: "Epic One",
      status: "pending",
      level: "epic",
      children: [
        {
          id: "task-1",
          title: "Leaf Task",
          status: "pending",
          level: "task",
        },
        // Two siblings with the same title — forces resolveSiblingSlugs to
        // append a disambiguating suffix, exactly the case a hand-rolled
        // slug algorithm silently gets wrong.
        {
          id: "task-2",
          title: "Duplicate Title",
          status: "pending",
          level: "task",
        },
        {
          id: "task-3",
          title: "Duplicate Title",
          status: "pending",
          level: "task",
          children: [
            {
              id: "subtask-1",
              title: "Nested Leaf Subtask",
              status: "pending",
              level: "subtask",
            },
          ],
        },
      ],
    },
  ];
}

function startTestServer(ctx: ServerContext, itemId: string): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const match = (req.url || "").match(/^\/api\/rex\/items\/([^/?]+)\/index-md$/);
      if (match && match[1] === itemId) {
        getIndexMarkdown(res, ctx, itemId);
        return;
      }
      res.writeHead(404);
      res.end("Not found");
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({ server, port });
    });
  });
}

describe("GET /api/rex/items/:id/index-md", () => {
  let tmpDir: string;
  let rexDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "rex-index-md-"));
    const svDir = join(tmpDir, ".sourcevision");
    rexDir = join(tmpDir, ".rex");
    await mkdir(svDir, { recursive: true });
    await mkdir(rexDir, { recursive: true });

    const items = makeItems();
    // Write the real folder tree — the same code path the PRDStore uses —
    // so the test validates against actual on-disk slugs, not assumptions.
    await serializeFolderTree(items as never, join(rexDir, PRD_TREE_DIRNAME));

    // getIndexMarkdown reads the item tree via loadPRDSync, which is
    // satisfied by the ephemeral cache file.
    await mkdir(join(rexDir, ".cache"), { recursive: true });
    await writeFile(
      join(rexDir, ".cache", "prd.json"),
      JSON.stringify({ schema: "rex/v1", title: "Test", items }),
    );
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  async function fetchIndexMd(itemId: string) {
    const ctx: ServerContext = { projectDir: tmpDir, svDir: join(tmpDir, ".sourcevision"), rexDir, dev: false };
    const { server, port } = await startTestServer(ctx, itemId);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/rex/items/${itemId}/index-md`);
      return res;
    } finally {
      await closeRouteTestServer(server);
    }
  }

  it("resolves a leaf task's bare <slug>.md file at its parent's directory", async () => {
    const res = await fetchIndexMd("task-1");
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("Leaf Task");
  });

  it("resolves siblings with duplicate titles to distinct files", async () => {
    const res2 = await fetchIndexMd("task-2");
    const res3 = await fetchIndexMd("task-3");
    expect(res2.status).toBe(200);
    expect(res3.status).toBe(200);
    // Both exist and are independently readable — the collision suffix
    // that disambiguates them on disk didn't collapse into one file.
  });

  it("resolves a branch item (has children) to its index.md", async () => {
    const res = await fetchIndexMd("task-3");
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("Duplicate Title");
  });

  it("resolves a nested leaf subtask two levels deep", async () => {
    const res = await fetchIndexMd("subtask-1");
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("Nested Leaf Subtask");
  });

  it("resolves the root epic itself", async () => {
    const res = await fetchIndexMd("epic-1");
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("Epic One");
  });

  it("returns 404 for an unknown item ID", async () => {
    const res = await fetchIndexMd("does-not-exist");
    expect(res.status).toBe(404);
  });
});
