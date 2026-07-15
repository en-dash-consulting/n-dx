/**
 * Unit tests for LiveJiraClient — the HTTP/ADF layer.
 *
 * Verifies the request contract (base URL, Basic auth, JQL search, ADF
 * conversion, error handling) by stubbing global fetch. Mirrors
 * asana-client.test.ts / github-projects-client.test.ts.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { LiveJiraClient, textToADF, adfToText } from "../../../src/store/jira-client.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe("ADF helpers", () => {
  it("round-trips plain text through ADF", () => {
    const text = "First line\n\nThird line";
    const adf = textToADF(text);
    expect(adf.type).toBe("doc");
    expect(adf.version).toBe(1);
    expect(adfToText(adf)).toBe(text);
  });

  it("extracts text from a foreign ADF document", () => {
    const adf = {
      type: "doc",
      version: 1,
      content: [{ type: "paragraph", content: [{ type: "text", text: "Hello" }] }],
    };
    expect(adfToText(adf)).toBe("Hello");
  });

  it("returns empty string for missing/invalid ADF", () => {
    expect(adfToText(undefined)).toBe("");
    expect(adfToText(null)).toBe("");
  });
});

describe("LiveJiraClient", () => {
  let client: LiveJiraClient;

  beforeEach(() => {
    client = new LiveJiraClient("acme.atlassian.net", "me@acme.com", "tok123");
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses the domain base URL and Basic auth", async () => {
    (fetch as any).mockResolvedValueOnce(jsonResponse({ key: "PRD-1" }));
    await client.createIssue({ projectKey: "PRD", issueType: "Task", summary: "T", description: "d" });

    const [url, init] = (fetch as any).mock.calls[0];
    expect(url).toBe("https://acme.atlassian.net/rest/api/3/issue");
    const expectedAuth = "Basic " + Buffer.from("me@acme.com:tok123").toString("base64");
    expect(init.headers.Authorization).toBe(expectedAuth);
  });

  it("creates an issue with an ADF description and issue type", async () => {
    (fetch as any).mockResolvedValueOnce(jsonResponse({ key: "PRD-7" }));
    const issue = await client.createIssue({
      projectKey: "PRD",
      issueType: "Story",
      summary: "Summary",
      description: "line1\nline2",
      labels: ["a", "b"],
    });

    const body = JSON.parse((fetch as any).mock.calls[0][1].body);
    expect(body.fields.project).toEqual({ key: "PRD" });
    expect(body.fields.issuetype).toEqual({ name: "Story" });
    expect(body.fields.summary).toBe("Summary");
    expect(body.fields.labels).toEqual(["a", "b"]);
    expect(body.fields.description.type).toBe("doc");
    expect(adfToText(body.fields.description)).toBe("line1\nline2");
    expect(issue.key).toBe("PRD-7");
  });

  it("updates an issue with PUT", async () => {
    (fetch as any).mockResolvedValueOnce(jsonResponse(undefined, 204));
    await client.updateIssue("PRD-7", { summary: "New", description: "body" });

    const [url, init] = (fetch as any).mock.calls[0];
    expect(init.method).toBe("PUT");
    expect(url).toBe("https://acme.atlassian.net/rest/api/3/issue/PRD-7");
    const body = JSON.parse(init.body);
    expect(body.fields.summary).toBe("New");
    expect(adfToText(body.fields.description)).toBe("body");
  });

  it("deletes an issue with DELETE", async () => {
    (fetch as any).mockResolvedValueOnce(jsonResponse(undefined, 204));
    await client.deleteIssue("PRD-7");

    const [url, init] = (fetch as any).mock.calls[0];
    expect(init.method).toBe("DELETE");
    expect(url).toBe("https://acme.atlassian.net/rest/api/3/issue/PRD-7");
  });

  it("lists issues via JQL search and unwraps ADF descriptions", async () => {
    (fetch as any).mockResolvedValueOnce(
      jsonResponse({
        total: 1,
        issues: [
          {
            key: "PRD-1",
            fields: {
              summary: "S",
              description: textToADF("desc body"),
              labels: ["x"],
            },
          },
        ],
      }),
    );

    const issues = await client.listIssues("PRD");

    const [url, init] = (fetch as any).mock.calls[0];
    expect(url).toBe("https://acme.atlassian.net/rest/api/3/search");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body).jql).toContain('project = "PRD"');
    expect(issues).toHaveLength(1);
    expect(issues[0]).toEqual({ key: "PRD-1", summary: "S", description: "desc body", labels: ["x"] });
  });

  it("paginates search results using startAt/total", async () => {
    (fetch as any)
      .mockResolvedValueOnce(
        jsonResponse({ total: 2, issues: [{ key: "PRD-1", fields: { summary: "A" } }] }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ total: 2, issues: [{ key: "PRD-2", fields: { summary: "B" } }] }),
      );

    const issues = await client.listIssues("PRD");
    expect(issues.map((i) => i.key)).toEqual(["PRD-1", "PRD-2"]);
    expect(JSON.parse((fetch as any).mock.calls[1][1].body).startAt).toBe(1);
  });

  it("throws with status and body on a non-ok response", async () => {
    (fetch as any).mockResolvedValueOnce(jsonResponse({ errorMessages: ["nope"] }, 401));
    await expect(
      client.createIssue({ projectKey: "PRD", issueType: "Task", summary: "T", description: "d" }),
    ).rejects.toThrow(/401/);
  });
});
/* eslint-enable @typescript-eslint/no-explicit-any */
