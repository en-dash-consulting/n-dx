/**
 * Workspace write-target strip — "you are editing this worktree's PRD".
 *
 * Every PRD-writing route resolves its store from the request's
 * `ctx.rexDir`, so a request made under `/w/<key>/` writes that worktree's
 * `.rex/prd_tree/` and nothing else. That is the safe behaviour, but it is
 * invisible: the PRD view under a branch worktree looks exactly like the
 * anchor's, and an edit made there does *not* reach the anchor. This strip
 * is the one line that says so.
 *
 * It renders only for a non-anchor workspace. On the anchor there is nothing
 * to warn about — the writes go where an unqualified "the PRD" means — and a
 * permanent banner on the common case would be noise.
 *
 * There is deliberately no cross-workspace write action anywhere in the
 * dashboard: editing the anchor's PRD while viewing a branch requires
 * switching workspace through the breadcrumb switcher, which is a full
 * navigation and therefore unmistakable. A "write to anchor instead"
 * affordance would reintroduce the ambiguity this strip exists to remove.
 */

import { h } from "preact";
import { getWorkspaceKey } from "../base-path.js";

export interface WorkspaceWriteStripProps {
  /** Injected for tests; defaults to the key derived from the base path. */
  workspaceKey?: string | null;
}

/**
 * The strip's text for a workspace key, or `null` when there is nothing to
 * say — the anchor (`null` key) and a blank key both mean "the served tree".
 */
export function workspaceWriteNotice(workspaceKey: string | null): string | null {
  if (!workspaceKey) return null;
  return `Workspace ${workspaceKey} · writes go to this worktree's PRD`;
}

export function WorkspaceWriteStrip({ workspaceKey }: WorkspaceWriteStripProps = {}) {
  const key = workspaceKey === undefined ? getWorkspaceKey() : workspaceKey;
  const notice = workspaceWriteNotice(key);
  if (notice === null) return null;

  return h("div", { class: "workspace-write-strip", role: "status" }, notice);
}
