/**
 * Workspaces domain views — barrel module.
 *
 * Domain scope: the worktrees of the served repository. One view today, but
 * it is its own sidebar section and its own import boundary — the registry
 * reaches every domain through a barrel, not through leaf modules.
 */

export { WorkspacesView } from "./workspaces.js";
export type { WorkspacesViewProps } from "./workspaces.js";
