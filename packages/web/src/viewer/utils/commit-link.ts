/**
 * Where to open a commit on the host serving the project's git remote.
 *
 * The viewer's one copy of this. It is a copy at all because viewer code is
 * bundled for the browser and limited to `viewer/external.ts` for its imports,
 * so it cannot reach `parseGitRemoteUrl` / `remoteToWebUrl` in
 * `@n-dx/llm-client`; `tests/e2e/architecture-policy.test.js` allowlists this
 * file for that reason, and a second viewer-side copy belongs here instead of
 * beside its caller. The real fix is for the server to send an already
 * normalized browse URL — see the allowlist entry.
 *
 * Pure, no framework dependencies, like the rest of `viewer/utils/`.
 */

/**
 * `<base>/commit/<sha>`, or null when the remote is not something a browser
 * can open — a filesystem path or an unknown scheme. Callers show the bare sha
 * for null rather than a link that goes nowhere.
 *
 * Handles both forms `git remote` reports: an https URL, and the scp-style
 * `git@host:owner/repo` that is not a URL at all and has to be rewritten
 * before it can be linked to.
 */
export function commitLinkUrl(sha: string, remoteUrl: string | null | undefined): string | null {
  if (!remoteUrl || !sha) return null;
  const scp = /^[^@/]+@([^:]+):(.+)$/.exec(remoteUrl);
  const base = (scp ? `https://${scp[1]}/${scp[2]}` : remoteUrl).replace(/\.git$/, "");
  if (!/^https?:\/\//.test(base)) return null;
  return `${base}/commit/${sha}`;
}
