/**
 * The OAuth callback a connection sign-in returns to, and the state that
 * routes it.
 *
 * Every sign-in returns to one fixed loopback address,
 * `http://127.0.0.1:<port>/oauth/callback` (or `localhost`), because that is
 * what n-dx's client ID metadata document lists. Behind the hub that address
 * is the hub's origin root, not the project's `/p/<id>/`, so the state names
 * where the return belongs: the hub reads the project to forward the browser
 * to `/p/<project>/oauth/callback`, and the viewer reads the workspace and the
 * connection it finishes. Only the random nonce is secret, and the server
 * keeps the whole state single-use; the routing fields are plain text.
 *
 * Format: `<project>~<workspace>~<connection>~<nonce>`, each routing field
 * percent-encoded (`~` included), empty when absent.
 *
 * Shared by the server (writes it), the hub (reads the project) and the
 * viewer (reads the workspace and connection). See
 * docs/architecture/sidecar-connections.md.
 */

/** Where an authorization server sends the browser back to, on the origin the dashboard was opened on. */
export const OAUTH_CALLBACK_PATH = "/oauth/callback";

/** Where a sign-in's return belongs and what it finishes. Only `nonce` is secret. */
export interface SignInState {
  /** The hub project id the dashboard was served under; absent when served directly. */
  project?: string;
  /** The worktree's workspace key; absent for the anchor. */
  workspace?: string;
  connection: string;
  nonce: string;
}

const SEPARATOR = "~";
const CONNECTION = /^[a-z][a-z0-9-]{0,30}$/;
const NONCE = /^[A-Za-z0-9_-]{16,}$/;

const encode = (value: string | undefined): string => encodeURIComponent(value ?? "").replaceAll(SEPARATOR, "%7E");

function decode(value: string): string | undefined {
  if (!value) return undefined;
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
}

export function formatSignInState(state: SignInState): string {
  return [encode(state.project), encode(state.workspace), state.connection, state.nonce].join(SEPARATOR);
}

/** `value` as a sign-in state, or null when it is not one. Says nothing about whether the server issued it. */
export function parseSignInState(value: string | null | undefined): SignInState | null {
  const parts = (value ?? "").split(SEPARATOR);
  if (parts.length !== 4) return null;
  const [project, workspace, connection, nonce] = parts;
  if (!CONNECTION.test(connection) || !NONCE.test(nonce)) return null;
  const decodedProject = decode(project);
  const decodedWorkspace = decode(workspace);
  if ((project && !decodedProject) || (workspace && !decodedWorkspace)) return null;
  return {
    ...(decodedProject && { project: decodedProject }),
    ...(decodedWorkspace && { workspace: decodedWorkspace }),
    connection,
    nonce,
  };
}
