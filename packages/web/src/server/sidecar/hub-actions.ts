/**
 * What an approved broker call does in the hub session.
 *
 * The hub session drafts and never acts: its only effects are a fixed
 * read-only command, a GitHub post, and a saved draft file, each decided on a
 * card. A command and a post run with cwd at the repository root of the one
 * project the card names, and gh answers under the operator's own login.
 * Everything else (work, edits, PRD writes, placements, migration decisions)
 * is not offered to the session, and refuses here too.
 *
 * Project ids resolve through the hub's own overview, never from a path the
 * agent gave. Design: local-design-workshop/docs/analysis/sidecar/README.md
 * §4.3, §6 (Draft, not do), §7 (Draft post).
 */

import type { ProjectCard } from "../../hub/index.js";
import type { BranchHealthExec } from "../branch-health/index.js";
import { errorMessage } from "../response-utils.js";
import { outputTail, type CarryOutResult, type SidecarActions } from "./carry-out.js";
import { saveDraftFile } from "./draft-file.js";
import { postGithubDraft } from "./github.js";
import { resolveHubAccess } from "./hub-snapshot-fetch.js";

const COMMAND_TIMEOUT_MS = 30_000;
const OVERVIEW_TIMEOUT_MS = 10_000;

export const HUB_NO_EFFECT = "a hub session drafts and never acts, so this call does nothing from the hub";

export interface HubActionsOptions {
  /** The per-user directory the hub's pid file and token are read from. */
  homeDir?: string;
  fetch?: typeof fetch;
  /** Runs a command; defaults to the llm-client `exec`. */
  exec: BranchHealthExec;
}

/** A project's repository root, from the hub's own overview. */
async function projectRepoRoot(
  opts: HubActionsOptions,
  project: string,
  signal?: AbortSignal,
): Promise<{ ok: true; repoRoot: string } | { ok: false; error: string }> {
  const access = resolveHubAccess(opts.homeDir);
  if (!access) return { ok: false, error: "no hub is running, so no project can be named" };
  try {
    const timeout = AbortSignal.timeout(OVERVIEW_TIMEOUT_MS);
    const res = await (opts.fetch ?? fetch)(`${access.baseUrl}/api/hub/overview`, {
      headers: access.token ? { "X-Ndx-Token": access.token } : {},
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (!res.ok) return { ok: false, error: `the hub's overview answered HTTP ${res.status}` };
    const { projects } = (await res.json()) as { projects: ProjectCard[] };
    const card = projects.find((p) => p.id === project);
    return card ? { ok: true, repoRoot: card.repoRoot } : { ok: false, error: `the hub has no project "${project}"` };
  } catch (err) {
    return { ok: false, error: `the hub's overview could not be read: ${errorMessage(err)}` };
  }
}

export function createHubActions(opts: HubActionsOptions): SidecarActions {
  const refused: CarryOutResult = { ok: false, text: `Nothing was done: ${HUB_NO_EFFECT}.` };
  return {
    previewWork: async () => HUB_NO_EFFECT,
    startWork: async () => refused,
    reviewChangeSet: async () => HUB_NO_EFFECT,
    writeChangeSet: async () => refused,
    readRunPlan: async () => HUB_NO_EFFECT,
    githubReadsAllowed: () => false,
    githubRead: async () => refused,
    projectRepoRoot: (project, signal) => projectRepoRoot(opts, project, signal),
    async runCommand(argv, signal, project) {
      if (!project) return { ok: false, text: "Nothing ran: a hub command names its project." };
      const root = await projectRepoRoot(opts, project, signal);
      if (!root.ok) return { ok: false, text: `Nothing ran: ${root.error}.` };
      const [cmd = "", ...args] = argv;
      const result = await opts.exec(cmd, args, { cwd: root.repoRoot, timeout: COMMAND_TIMEOUT_MS });
      const line = `\`${argv.join(" ")}\` in ${project}`;
      if (!result.launched) return { ok: false, text: `Nothing ran: ${cmd} could not be started.` };
      const tail = outputTail(`${result.stdout}${result.stderr}`);
      const ended = result.exitCode === null ? `ended without an exit code: ${result.error?.message ?? "timed out"}` : `exited with code ${result.exitCode}`;
      return { ok: result.exitCode === 0, text: `${line} ${ended}.\n${tail.text ? `Output:\n${tail.text}` : "It printed nothing."}` };
    },
    async postGithub(draft) {
      if (!draft.project) return { ok: false, text: "Nothing was posted: a hub draft names its project." };
      const root = await projectRepoRoot(opts, draft.project);
      if (!root.ok) return { ok: false, text: `Nothing was posted: ${root.error}.` };
      return postGithubDraft(opts.exec, root.repoRoot, draft);
    },
    saveDraft: (path, content) => saveDraftFile(path, content),
  };
}
