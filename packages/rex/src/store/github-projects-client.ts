/**
 * Thin abstraction over the GitHub Projects (v2) GraphQL API for rex sync.
 *
 * Consumers inject a concrete implementation (live or mock) into the
 * GitHubProjectsStore adapter. This keeps HTTP/GraphQL concerns out of the
 * store layer and makes the adapter fully testable without network calls —
 * mirroring the NotionClient / AsanaClient seams.
 *
 * GitHub Projects v2 is a flat collection of items; each PRD item is stored as
 * a draft issue (title + body). PRD-only structure (hierarchy, level, status,
 * …) is encoded in the draft-issue body by the mapping layer.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface GitHubProjectsAdapterConfig {
  /** GitHub personal access token with `project` scope. */
  token: string;
  /** Node ID of the target ProjectV2 (e.g. "PVT_kwxxx"). */
  projectId: string;
}

// ---------------------------------------------------------------------------
// Domain shape
// ---------------------------------------------------------------------------

/**
 * A project item backed by a draft issue. `itemId` is the ProjectV2Item id
 * (needed to delete the item); `contentId` is the DraftIssue id (needed to
 * update its title/body).
 */
export interface GitHubProjectItem {
  itemId: string;
  contentId: string;
  title: string;
  body: string;
}

export interface DraftContent {
  title: string;
  body: string;
}

// ---------------------------------------------------------------------------
// Client interface
// ---------------------------------------------------------------------------

export interface GitHubProjectsClient {
  /** List every draft-issue item in the project (handles pagination). */
  listItems(projectId: string): Promise<GitHubProjectItem[]>;

  /** Add a draft issue to the project. */
  createDraftItem(projectId: string, content: DraftContent): Promise<GitHubProjectItem>;

  /** Update an existing draft issue's title and body. */
  updateDraftItem(contentId: string, content: DraftContent): Promise<GitHubProjectItem>;

  /** Remove an item from the project. */
  deleteItem(projectId: string, itemId: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Live implementation — calls the GitHub GraphQL API directly
// ---------------------------------------------------------------------------

const GITHUB_GRAPHQL = "https://api.github.com/graphql";

const LIST_QUERY = `
query($projectId: ID!, $cursor: String) {
  node(id: $projectId) {
    ... on ProjectV2 {
      items(first: 100, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          content {
            ... on DraftIssue { id title body }
          }
        }
      }
    }
  }
}`;

const CREATE_MUTATION = `
mutation($projectId: ID!, $title: String!, $body: String!) {
  addProjectV2DraftIssue(input: { projectId: $projectId, title: $title, body: $body }) {
    projectItem {
      id
      content { ... on DraftIssue { id title body } }
    }
  }
}`;

const UPDATE_MUTATION = `
mutation($draftIssueId: ID!, $title: String!, $body: String!) {
  updateProjectV2DraftIssue(input: { draftIssueId: $draftIssueId, title: $title, body: $body }) {
    draftIssue { id title body }
  }
}`;

const DELETE_MUTATION = `
mutation($projectId: ID!, $itemId: ID!) {
  deleteProjectV2Item(input: { projectId: $projectId, itemId: $itemId }) {
    deletedItemId
  }
}`;

export class LiveGitHubProjectsClient implements GitHubProjectsClient {
  private token: string;

  constructor(token: string) {
    this.token = token;
  }

  private async graphql(query: string, variables: Record<string, unknown>): Promise<any> {
    const res = await fetch(GITHUB_GRAPHQL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`GitHub GraphQL failed (${res.status}): ${text}`);
    }
    const json = await res.json();
    if (json.errors && json.errors.length > 0) {
      const message = json.errors.map((e: any) => e.message).join("; ");
      throw new Error(`GitHub GraphQL error: ${message}`);
    }
    return json.data;
  }

  async listItems(projectId: string): Promise<GitHubProjectItem[]> {
    const items: GitHubProjectItem[] = [];
    let cursor: string | undefined;

    do {
      const data = await this.graphql(LIST_QUERY, { projectId, cursor: cursor ?? null });
      const connection = data?.node?.items;
      for (const node of connection?.nodes ?? []) {
        const content = node.content;
        // Only draft-issue items carry a title/body we can round-trip.
        if (content && typeof content.title === "string") {
          items.push({
            itemId: node.id,
            contentId: content.id,
            title: content.title,
            body: content.body ?? "",
          });
        }
      }
      cursor = connection?.pageInfo?.hasNextPage ? connection.pageInfo.endCursor : undefined;
    } while (cursor);

    return items;
  }

  async createDraftItem(projectId: string, content: DraftContent): Promise<GitHubProjectItem> {
    const data = await this.graphql(CREATE_MUTATION, {
      projectId,
      title: content.title,
      body: content.body,
    });
    const projectItem = data.addProjectV2DraftIssue.projectItem;
    return {
      itemId: projectItem.id,
      contentId: projectItem.content.id,
      title: projectItem.content.title,
      body: projectItem.content.body ?? "",
    };
  }

  async updateDraftItem(contentId: string, content: DraftContent): Promise<GitHubProjectItem> {
    const data = await this.graphql(UPDATE_MUTATION, {
      draftIssueId: contentId,
      title: content.title,
      body: content.body,
    });
    const draft = data.updateProjectV2DraftIssue.draftIssue;
    return {
      itemId: "",
      contentId: draft.id,
      title: draft.title,
      body: draft.body ?? "",
    };
  }

  async deleteItem(projectId: string, itemId: string): Promise<void> {
    await this.graphql(DELETE_MUTATION, { projectId, itemId });
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */
