/**
 * Thin abstraction over the Asana API for rex sync.
 *
 * Consumers inject a concrete implementation (live or mock) into the
 * AsanaStore adapter. This keeps HTTP concerns out of the store layer and
 * makes the adapter fully testable without network calls — mirroring the
 * NotionClient seam in `notion-client.ts`.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface AsanaAdapterConfig {
  /** Asana personal access token (used as a Bearer credential). */
  token: string;
  /** GID of the Asana project that holds the PRD tasks. */
  projectId: string;
}

// ---------------------------------------------------------------------------
// Domain shape
// ---------------------------------------------------------------------------

/**
 * Reference to an external system stored on an Asana task. Asana provides this
 * field specifically for integrations to persist a foreign key — we use it to
 * carry the PRD item ID (`gid`) plus a JSON blob of PRD-only metadata (`data`)
 * that has no native Asana equivalent (level, status, priority).
 */
export interface AsanaExternal {
  gid: string;
  data?: string;
}

/** The subset of Asana task fields the adapter reads and writes. */
export interface AsanaTask {
  gid: string;
  name: string;
  notes?: string;
  completed?: boolean;
  /** Parent task reference for subtasks; null/absent for project-level tasks. */
  parent?: { gid: string } | null;
  external?: AsanaExternal | null;
}

/** Fields accepted when creating a task. */
export interface AsanaCreateParams {
  name: string;
  notes?: string;
  completed?: boolean;
  /** Project GIDs to add the task to (used for top-level items). */
  projects?: string[];
  /** Parent task GID (used for subtasks; mutually exclusive with projects). */
  parent?: string;
  external?: AsanaExternal;
}

/** Fields accepted when updating a task. */
export interface AsanaUpdateParams {
  name?: string;
  notes?: string;
  completed?: boolean;
  external?: AsanaExternal;
}

// ---------------------------------------------------------------------------
// Client interface
// ---------------------------------------------------------------------------

export interface AsanaClient {
  /**
   * List every task in the project, including nested subtasks, as a flat array.
   * Each subtask carries a `parent` reference so the caller can rebuild the tree.
   */
  listTasks(projectId: string): Promise<AsanaTask[]>;

  /** Create a task (project-level or a subtask of another task). */
  createTask(params: AsanaCreateParams): Promise<AsanaTask>;

  /** Update an existing task's fields. */
  updateTask(gid: string, params: AsanaUpdateParams): Promise<AsanaTask>;

  /** Permanently delete a task (Asana has no archive/soft-delete). */
  deleteTask(gid: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Live implementation — calls the Asana REST API directly
// ---------------------------------------------------------------------------

const ASANA_API = "https://app.asana.com/api/1.0";
const TASK_OPT_FIELDS = "name,notes,completed,parent,external";

export class LiveAsanaClient implements AsanaClient {
  private token: string;

  constructor(token: string) {
    this.token = token;
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      "Content-Type": "application/json",
    };
  }

  private async request(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<any> {
    const url = `${ASANA_API}${path}`;
    const res = await fetch(url, {
      method,
      headers: this.headers(),
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `Asana API ${method} ${path} failed (${res.status}): ${text}`,
      );
    }
    if (res.status === 204) return undefined;
    return res.json();
  }

  /** Fetch a paginated collection, following `next_page.offset` cursors. */
  private async collect(path: string): Promise<any[]> {
    const results: any[] = [];
    let offset: string | undefined;
    const sep = path.includes("?") ? "&" : "?";

    do {
      const paged = `${path}${sep}limit=100${offset ? `&offset=${offset}` : ""}`;
      const res = await this.request("GET", paged);
      results.push(...(res.data ?? []));
      offset = res.next_page?.offset ?? undefined;
    } while (offset);

    return results;
  }

  async listTasks(projectId: string): Promise<AsanaTask[]> {
    const topLevel = await this.collect(
      `/projects/${projectId}/tasks?opt_fields=${TASK_OPT_FIELDS}`,
    );

    // Breadth-first descent into subtasks. Asana's project-tasks endpoint only
    // returns direct children of the project, so subtasks must be fetched per
    // parent. Each fetched subtask carries its own `parent` reference.
    const all: AsanaTask[] = [...topLevel];
    const queue: string[] = topLevel.map((t) => t.gid);
    while (queue.length > 0) {
      const gid = queue.shift() as string;
      const subs = await this.collect(
        `/tasks/${gid}/subtasks?opt_fields=${TASK_OPT_FIELDS}`,
      );
      for (const sub of subs) {
        all.push(sub);
        queue.push(sub.gid);
      }
    }

    return all;
  }

  async createTask(params: AsanaCreateParams): Promise<AsanaTask> {
    const res = await this.request("POST", `/tasks?opt_fields=${TASK_OPT_FIELDS}`, {
      data: params,
    });
    return res.data;
  }

  async updateTask(gid: string, params: AsanaUpdateParams): Promise<AsanaTask> {
    const res = await this.request(
      "PUT",
      `/tasks/${gid}?opt_fields=${TASK_OPT_FIELDS}`,
      { data: params },
    );
    return res.data;
  }

  async deleteTask(gid: string): Promise<void> {
    await this.request("DELETE", `/tasks/${gid}`);
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */
