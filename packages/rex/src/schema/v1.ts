export const SCHEMA_VERSION = "rex/v1";

export type ItemLevel = "epic" | "feature" | "task" | "subtask";

export type ItemStatus = "pending" | "in_progress" | "completed" | "deferred" | "blocked";

export type Priority = "critical" | "high" | "medium" | "low";

export interface PRDItem {
  id: string;
  title: string;
  status: ItemStatus;
  level: ItemLevel;
  description?: string;
  acceptanceCriteria?: string[];
  priority?: Priority;
  tags?: string[];
  source?: string;
  blockedBy?: string[];
  children?: PRDItem[];
  [key: string]: unknown;
}

export interface PRDDocument {
  schema: string;
  title: string;
  items: PRDItem[];
  [key: string]: unknown;
}

export interface RexConfig {
  schema: string;
  project: string;
  adapter: string;
  validate?: string;
  test?: string;
  sourcevision?: string;
  model?: string;
  future?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface LogEntry {
  timestamp: string;
  event: string;
  itemId?: string;
  detail?: string;
  [key: string]: unknown;
}

export const LEVEL_HIERARCHY: Record<ItemLevel, ItemLevel | null> = {
  epic: null,
  feature: "epic",
  task: "feature",
  subtask: "task",
};

export function DEFAULT_CONFIG(project: string): RexConfig {
  return {
    schema: SCHEMA_VERSION,
    project,
    adapter: "file",
    sourcevision: "auto",
  };
}
