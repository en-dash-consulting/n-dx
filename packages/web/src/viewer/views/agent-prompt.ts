/**
 * Agent prompt — an editor for the project's agent prompt file.
 *
 * The file (`.ndx/agent-prompt.md` by default, or wherever `agent.promptFile`
 * points) is appended to the system prompt of every n-dx agent process: each
 * `ndx work` run, its reviewer, and the Sidecar. Empty means no change.
 *
 * Self-contained on purpose: it keeps its own dirty state and its own Save and
 * Discard, and never mounts a SettingsFrame — only one frame may be mounted at
 * a time (see `components/settings-frame.ts`), and this section is placed both
 * inside the Workflow page's frame and on the Work page, which has none.
 *
 * Data comes from GET /api/agent-prompt and is written with PUT.
 */

import { h } from "preact";
import type { ComponentChildren } from "preact";
import { useCallback, useEffect, useState } from "preact/hooks";
import { responseError } from "../utils/response-error.js";

/** GET/PUT /api/agent-prompt, as `routes-agent-prompt.ts` answers it. */
export interface AgentPromptData {
  /** Project-relative path of the file. */
  path: string;
  content: string;
  exists: boolean;
  bytes: number;
  maxBytes: number;
  /** The file is longer than agents receive; `content` is the received part. */
  truncated: boolean;
  configured: boolean;
  warnings: string[];
}

export interface AgentPromptSectionProps {
  /** A shorter editor, for the Work page's Tune sub-section. */
  compact?: boolean;
  /**
   * Never rendered. Declared so the props type is not a "weak type" (all
   * optional, nothing shared with `h()`'s attributes), which would make
   * `h(AgentPromptSection, {})` a type error.
   */
  children?: ComponentChildren;
}

const ENDPOINT = "/api/agent-prompt";
/** The server's cap, used only until the first response names it. */
const DEFAULT_MAX_BYTES = 32 * 1024;

/** UTF-8 byte length, the unit the server's cap is in. */
export function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** A response with every field present, so an older server's partial body cannot break rendering. */
function normalize(raw: Partial<AgentPromptData>): AgentPromptData {
  const content = typeof raw.content === "string" ? raw.content : "";
  return {
    path: typeof raw.path === "string" ? raw.path : ".ndx/agent-prompt.md",
    content,
    exists: raw.exists === true,
    bytes: typeof raw.bytes === "number" ? raw.bytes : utf8Bytes(content),
    maxBytes: typeof raw.maxBytes === "number" ? raw.maxBytes : DEFAULT_MAX_BYTES,
    truncated: raw.truncated === true,
    configured: raw.configured === true,
    warnings: Array.isArray(raw.warnings) ? raw.warnings.filter((w): w is string => typeof w === "string") : [],
  };
}

function formatKb(bytes: number): string {
  const kb = bytes / 1024;
  return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
}

export function AgentPromptSection({ compact = false }: AgentPromptSectionProps) {
  const [data, setData] = useState<AgentPromptData | null>(null);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const accept = useCallback((raw: Partial<AgentPromptData>) => {
    const next = normalize(raw);
    setData(next);
    setDraft(next.content);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(ENDPOINT);
        if (!res.ok) {
          const message = await responseError(res, "Failed to load the agent prompt");
          if (!cancelled) setLoadError(message);
          return;
        }
        const body = await res.json() as Partial<AgentPromptData>;
        if (!cancelled) {
          accept(body);
          setLoadError(null);
        }
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Failed to load the agent prompt");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [accept]);

  const dirty = data !== null && draft !== data.content;
  const bytes = utf8Bytes(draft);
  const maxBytes = data?.maxBytes ?? DEFAULT_MAX_BYTES;
  const overCap = bytes > maxBytes;
  // A truncated file shows only what agents receive; saving it from here would
  // cut the rest off the file, so it is edited on disk instead.
  const readOnly = data?.truncated === true;

  const save = useCallback(async () => {
    if (!dirty || overCap || readOnly) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(ENDPOINT, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: draft }),
      });
      if (!res.ok) {
        setSaveError(await responseError(res, "Save failed"));
        return;
      }
      accept(await res.json() as Partial<AgentPromptData>);
      setSavedAt(Date.now());
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }, [accept, dirty, draft, overCap, readOnly]);

  const discard = useCallback(() => {
    if (data) setDraft(data.content);
    setSaveError(null);
  }, [data]);

  const rootClass = `agent-prompt${compact ? " agent-prompt--compact" : ""}`;

  if (loading) {
    return h("div", { class: rootClass }, h("p", { class: "agent-prompt-status" }, "Loading the agent prompt…"));
  }
  if (loadError || !data) {
    return h("div", { class: rootClass },
      h("p", { class: "agent-prompt-error", role: "alert" }, loadError ?? "Failed to load the agent prompt"),
    );
  }

  const status = dirty
    ? "Unsaved changes"
    : savedAt !== null
      ? "Saved"
      : data.exists && data.content.trim() !== "" ? "In use" : "Not set";

  return h("div", { class: rootClass },
    h("p", { class: "agent-prompt-desc" },
      "Added to the system prompt of every n-dx agent — ",
      h("code", null, "work"),
      " runs, their reviewers and the Sidecar. Leave it empty to add nothing.",
    ),
    h("div", { class: "agent-prompt-meta" },
      h("code", { class: "agent-prompt-path", title: data.configured ? "Set by agent.promptFile" : "Default location" }, data.path),
      data.configured ? h("span", { class: "agent-prompt-badge" }, "agent.promptFile") : null,
      h("span", { class: `agent-prompt-state${dirty ? " agent-prompt-state--dirty" : ""}`, role: "status" }, status),
    ),
    data.warnings.length > 0 || readOnly
      ? h("ul", { class: "agent-prompt-warnings" },
        data.warnings.map((w) => h("li", { key: w }, w)),
        readOnly ? h("li", null, "Shown read-only: saving here would cut the file down to that part. Edit the file directly.") : null,
      )
      : null,
    h("textarea", {
      class: `agent-prompt-input${overCap ? " agent-prompt-input--error" : ""}`,
      value: draft,
      rows: compact ? 6 : 12,
      readOnly,
      spellcheck: false,
      placeholder: "e.g. Prefer small commits. Never edit generated files under dist/.",
      "aria-label": `Agent prompt (${data.path})`,
      onInput: (e: Event) => {
        setDraft((e.target as HTMLTextAreaElement).value);
        setSavedAt(null);
      },
    }),
    h("div", { class: "agent-prompt-footer" },
      h("span", { class: `agent-prompt-size${overCap ? " agent-prompt-size--over" : ""}` },
        `${formatKb(bytes)} of ${formatKb(maxBytes)}`,
      ),
      saveError ? h("span", { class: "agent-prompt-error", role: "alert" }, saveError) : null,
      overCap ? h("span", { class: "agent-prompt-error" }, "Too long to save — agents receive at most the limit.") : null,
      h("div", { class: "agent-prompt-actions" },
        h("button", {
          type: "button",
          class: "agent-prompt-discard",
          disabled: !dirty || saving,
          onClick: discard,
        }, "Discard"),
        h("button", {
          type: "button",
          class: "agent-prompt-save",
          disabled: !dirty || saving || overCap || readOnly,
          onClick: () => { void save(); },
        }, saving ? "Saving…" : "Save"),
      ),
    ),
  );
}
