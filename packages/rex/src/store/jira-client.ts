/**
 * Thin abstraction over the Jira Cloud REST API (v3) for rex sync.
 *
 * Consumers inject a concrete implementation (live or mock) into the JiraStore
 * adapter. This keeps HTTP concerns out of the store layer and makes the
 * adapter fully testable without network calls — mirroring the NotionClient /
 * AsanaClient / GitHubProjectsClient seams.
 *
 * Jira descriptions use the Atlassian Document Format (ADF). LiveJiraClient
 * converts plain text ↔ ADF internally, so the mapping layer only ever deals
 * with plain-text descriptions.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface JiraAdapterConfig {
  /** Jira Cloud domain, e.g. "your-company.atlassian.net" (no protocol). */
  domain: string;
  /** Account email used with the API token for Basic auth. */
  email: string;
  /** Jira API token (secret). */
  apiToken: string;
  /** Project key new issues are created in, e.g. "PRD". */
  projectKey: string;
  /** Issue type for new issues (default "Task"). */
  issueType?: string;
  /** When true, PRD tags are written to Jira issue labels. */
  syncLabels?: boolean;
}

// ---------------------------------------------------------------------------
// Domain shape
// ---------------------------------------------------------------------------

/** The subset of an issue the adapter reads/writes (description as plain text). */
export interface JiraIssue {
  key: string;
  summary: string;
  description: string;
  labels: string[];
}

export interface JiraCreateParams {
  projectKey: string;
  issueType: string;
  summary: string;
  description: string;
  labels?: string[];
}

export interface JiraUpdateParams {
  summary: string;
  description: string;
  labels?: string[];
}

// ---------------------------------------------------------------------------
// Client interface
// ---------------------------------------------------------------------------

export interface JiraClient {
  /** List all issues in the project (handles pagination). */
  listIssues(projectKey: string): Promise<JiraIssue[]>;

  /** Create an issue and return it. */
  createIssue(params: JiraCreateParams): Promise<JiraIssue>;

  /** Update an existing issue's fields. */
  updateIssue(key: string, params: JiraUpdateParams): Promise<void>;

  /** Delete an issue. */
  deleteIssue(key: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// ADF (Atlassian Document Format) helpers — exported for testing.
// ---------------------------------------------------------------------------

/** Convert plain text (with newlines) into a minimal ADF document. */
export function textToADF(text: string): any {
  const lines = text.split("\n");
  const content = lines.map((line) =>
    line.length > 0
      ? { type: "paragraph", content: [{ type: "text", text: line }] }
      : { type: "paragraph" },
  );
  return { type: "doc", version: 1, content };
}

/** Extract the plain-text content from an ADF document. */
export function adfToText(adf: any): string {
  if (!adf || typeof adf !== "object") return "";
  const lines: string[] = [];
  const walkParagraph = (node: any): string => {
    const parts: string[] = [];
    for (const child of node.content ?? []) {
      if (child.type === "text" && typeof child.text === "string") {
        parts.push(child.text);
      }
    }
    return parts.join("");
  };
  for (const node of adf.content ?? []) {
    if (node.type === "paragraph") {
      lines.push(walkParagraph(node));
    }
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Live implementation — calls the Jira Cloud REST API directly
// ---------------------------------------------------------------------------

export class LiveJiraClient implements JiraClient {
  private baseUrl: string;
  private authHeader: string;

  constructor(domain: string, email: string, apiToken: string) {
    this.baseUrl = `https://${domain}/rest/api/3`;
    const encoded = Buffer.from(`${email}:${apiToken}`).toString("base64");
    this.authHeader = `Basic ${encoded}`;
  }

  private async request(method: string, path: string, body?: unknown): Promise<any> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: this.authHeader,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Jira API ${method} ${path} failed (${res.status}): ${text}`);
    }
    if (res.status === 204) return undefined;
    return res.json();
  }

  async listIssues(projectKey: string): Promise<JiraIssue[]> {
    const issues: JiraIssue[] = [];
    let startAt = 0;
    const maxResults = 100;

    for (;;) {
      const res = await this.request("POST", "/search", {
        jql: `project = "${projectKey}" ORDER BY created ASC`,
        startAt,
        maxResults,
        fields: ["summary", "description", "labels"],
      });
      for (const issue of res.issues ?? []) {
        issues.push({
          key: issue.key,
          summary: issue.fields?.summary ?? "",
          description: adfToText(issue.fields?.description),
          labels: Array.isArray(issue.fields?.labels) ? issue.fields.labels : [],
        });
      }
      startAt += res.issues?.length ?? 0;
      const total = res.total ?? issues.length;
      if (!res.issues || res.issues.length === 0 || startAt >= total) break;
    }

    return issues;
  }

  async createIssue(params: JiraCreateParams): Promise<JiraIssue> {
    const fields: Record<string, any> = {
      project: { key: params.projectKey },
      summary: params.summary,
      description: textToADF(params.description),
      issuetype: { name: params.issueType },
    };
    if (params.labels && params.labels.length > 0) fields.labels = params.labels;

    const res = await this.request("POST", "/issue", { fields });
    return {
      key: res.key,
      summary: params.summary,
      description: params.description,
      labels: params.labels ?? [],
    };
  }

  async updateIssue(key: string, params: JiraUpdateParams): Promise<void> {
    const fields: Record<string, any> = {
      summary: params.summary,
      description: textToADF(params.description),
    };
    if (params.labels) fields.labels = params.labels;
    await this.request("PUT", `/issue/${key}`, { fields });
  }

  async deleteIssue(key: string): Promise<void> {
    await this.request("DELETE", `/issue/${key}`);
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */
