/**
 * The notice shown when a dashboard server answered the viewer's first
 * `/data` request but would not serve it.
 *
 * Before this existed, every such answer fell through to the file-drop box —
 * "Drop .sourcevision files" — which told a reader whose server was simply
 * still starting to go and copy files the server already had. The wording
 * here names what actually happened and what, if anything, to do about it;
 * `useAppData` keeps re-probing in the background, so most of these resolve
 * on their own.
 */

import { h } from "preact";
import type { ServerUnavailable } from "../hooks/index.js";
import { useCliName, resolveCliLabel } from "../hooks/index.js";

export interface ServerUnavailableCopy {
  title: string;
  body: string;
  /** Whether the viewer's own retrying will resolve this without the reader acting. */
  retrying: boolean;
}

/**
 * Pure: the words for one refusal, with the project's CLI name substituted
 * for `{cli}`. Exported for tests.
 */
export function serverUnavailableCopy(error: ServerUnavailable, cliName: string): ServerUnavailableCopy {
  const copy = rawCopy(error);
  return { ...copy, body: resolveCliLabel(copy.body, cliName) };
}

function rawCopy(error: ServerUnavailable): ServerUnavailableCopy {
  const { status, detail } = error;
  switch (status) {
    case 0:
      return {
        title: "The dashboard server is not answering",
        body: "Nothing answered at this address. If you just stopped it, start it again with `{cli} start .`.",
        retrying: true,
      };
    case 401:
      return {
        title: "Sign in to the dashboard again",
        body: "The server refused the request (401): this tab is not signed in, or its session ended when the server restarted. Run `{cli} start` again and open the URL it prints — a one-time sign-in link.",
        retrying: false,
      };
    case 403:
      return {
        title: "The server refused this page's origin",
        body: detail ? `${detail} (403).` : "The request was rejected as cross-origin (403). Open the dashboard by the address `{cli} start` printed.",
        retrying: false,
      };
    case 409:
      return {
        title: "Several projects share this port",
        body: "The hub serves more than one project, so the bare address no longer names one (409). Open this project from the hub's project list.",
        retrying: false,
      };
    case 421:
      return {
        title: "Open the dashboard by its own address",
        body: "The server only answers requests addressed to localhost on its own port (421). Use the address `{cli} start` printed rather than another host name or a forwarded port.",
        retrying: false,
      };
    case 502:
    case 503:
    case 504:
      return {
        title: "Waiting for the project server",
        body: `${detail ?? "The hub reached no running server for this project"} (${status}). \`{cli} start\` may still be bringing it up.`,
        retrying: true,
      };
    default:
      return {
        title: `The server answered ${status}`,
        body: detail ?? "The dashboard server answered, but not with its data.",
        retrying: status >= 500,
      };
  }
}

export interface ServerUnavailableNoticeProps {
  error: ServerUnavailable;
}

export function ServerUnavailableNotice({ error }: ServerUnavailableNoticeProps) {
  const cliName = useCliName();
  const copy = serverUnavailableCopy(error, cliName);
  return h("div", { class: "drop-overlay", role: "alertdialog", "aria-label": "Dashboard server unavailable", "aria-live": "polite" },
    h("div", { class: "drop-box server-unavailable" },
      h("h2", null, copy.title),
      h("p", null, copy.body),
      h("p", { class: "server-unavailable-retry" },
        copy.retrying ? "This page retries on its own; it loads as soon as the server answers." : "This page checks again every few seconds once that is done."),
    ),
  );
}
