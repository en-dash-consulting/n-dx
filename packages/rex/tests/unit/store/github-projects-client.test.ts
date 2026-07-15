/**
 * Unit tests for LiveGitHubProjectsClient — the GraphQL/HTTP layer.
 *
 * Verifies the request contract (endpoint, auth, GraphQL variables, response
 * unwrapping, error handling) by stubbing global fetch. Mirrors
 * asana-client.test.ts / notion-client.test.ts.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { LiveGitHubProjectsClient } from "../../../src/store/github-projects-client.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

function gqlResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe("LiveGitHubProjectsClient", () => {
  let client: LiveGitHubProjectsClient;

  beforeEach(() => {
    client = new LiveGitHubProjectsClient("ghp_token");
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts to the GraphQL endpoint with a Bearer token", async () => {
    (fetch as any).mockResolvedValueOnce(
      gqlResponse({ data: { addProjectV2DraftIssue: { projectItem: { id: "i", content: { id: "c", title: "T", body: "" } } } } }),
    );
    await client.createDraftItem("PVT_1", { title: "T", body: "" });

    const [url, init] = (fetch as any).mock.calls[0];
    expect(url).toBe("https://api.github.com/graphql");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer ghp_token");
    expect(init.headers["Content-Type"]).toBe("application/json");
  });

  it("creates a draft item and unwraps ids", async () => {
    (fetch as any).mockResolvedValueOnce(
      gqlResponse({
        data: {
          addProjectV2DraftIssue: {
            projectItem: { id: "PVTI_9", content: { id: "DI_9", title: "T", body: "b" } },
          },
        },
      }),
    );
    const item = await client.createDraftItem("PVT_1", { title: "T", body: "b" });

    const body = JSON.parse((fetch as any).mock.calls[0][1].body);
    expect(body.query).toContain("addProjectV2DraftIssue");
    expect(body.variables).toEqual({ projectId: "PVT_1", title: "T", body: "b" });
    expect(item).toEqual({ itemId: "PVTI_9", contentId: "DI_9", title: "T", body: "b" });
  });

  it("updates a draft item by draft issue id", async () => {
    (fetch as any).mockResolvedValueOnce(
      gqlResponse({
        data: { updateProjectV2DraftIssue: { draftIssue: { id: "DI_9", title: "T2", body: "b2" } } },
      }),
    );
    const item = await client.updateDraftItem("DI_9", { title: "T2", body: "b2" });

    const body = JSON.parse((fetch as any).mock.calls[0][1].body);
    expect(body.query).toContain("updateProjectV2DraftIssue");
    expect(body.variables).toEqual({ draftIssueId: "DI_9", title: "T2", body: "b2" });
    expect(item.contentId).toBe("DI_9");
    expect(item.title).toBe("T2");
  });

  it("deletes an item by project + item id", async () => {
    (fetch as any).mockResolvedValueOnce(
      gqlResponse({ data: { deleteProjectV2Item: { deletedItemId: "PVTI_9" } } }),
    );
    await client.deleteItem("PVT_1", "PVTI_9");

    const body = JSON.parse((fetch as any).mock.calls[0][1].body);
    expect(body.query).toContain("deleteProjectV2Item");
    expect(body.variables).toEqual({ projectId: "PVT_1", itemId: "PVTI_9" });
  });

  it("lists draft-issue items, skipping non-draft content", async () => {
    (fetch as any).mockResolvedValueOnce(
      gqlResponse({
        data: {
          node: {
            items: {
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: [
                { id: "PVTI_1", content: { id: "DI_1", title: "Draft", body: "b1" } },
                { id: "PVTI_2", content: {} }, // e.g. a real issue with no title field selected
              ],
            },
          },
        },
      }),
    );

    const items = await client.listItems("PVT_1");
    expect(items).toHaveLength(1);
    expect(items[0]).toEqual({ itemId: "PVTI_1", contentId: "DI_1", title: "Draft", body: "b1" });
  });

  it("follows pagination cursors", async () => {
    (fetch as any)
      .mockResolvedValueOnce(
        gqlResponse({
          data: {
            node: {
              items: {
                pageInfo: { hasNextPage: true, endCursor: "CUR1" },
                nodes: [{ id: "PVTI_1", content: { id: "DI_1", title: "A", body: "" } }],
              },
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        gqlResponse({
          data: {
            node: {
              items: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: [{ id: "PVTI_2", content: { id: "DI_2", title: "B", body: "" } }],
              },
            },
          },
        }),
      );

    const items = await client.listItems("PVT_1");
    expect(items.map((i) => i.contentId)).toEqual(["DI_1", "DI_2"]);
    expect(JSON.parse((fetch as any).mock.calls[1][1].body).variables.cursor).toBe("CUR1");
  });

  it("throws on GraphQL errors (200 with errors array)", async () => {
    (fetch as any).mockResolvedValueOnce(
      gqlResponse({ errors: [{ message: "Could not resolve to a node" }] }),
    );
    await expect(client.listItems("PVT_bad")).rejects.toThrow(/Could not resolve to a node/);
  });

  it("throws on a non-ok HTTP response", async () => {
    (fetch as any).mockResolvedValueOnce(gqlResponse({ message: "Bad credentials" }, 401));
    await expect(client.listItems("PVT_1")).rejects.toThrow(/401/);
  });
});
/* eslint-enable @typescript-eslint/no-explicit-any */
