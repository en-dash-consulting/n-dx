import { h, type ComponentChildren } from "preact";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { BrandedHeader } from "../components/logos.js";

interface PRMarkdownResponse {
  markdown: string | null;
  signature?: string;
  availability?: "ready" | "unsupported" | "no-repo" | "error";
  message?: string | null;
  warning?: string | null;
  baseRange?: string | null;
  mode?: "normal" | "fallback";
  confidence?: number;
  coverage?: number;
}

interface PRMarkdownStateResponse {
  signature: string;
  availability?: "ready" | "unsupported" | "no-repo" | "error";
  message?: string | null;
  warning?: string | null;
  baseRange?: string | null;
  cacheStatus?: "missing" | "fresh" | "stale";
  generatedAt?: string | null;
  staleAfterMs?: number;
  mode?: "normal" | "fallback";
  confidence?: number;
  coverage?: number;
}

interface PRMarkdownRefreshResponse extends PRMarkdownStateResponse {
  ok?: boolean;
  status?: "ok" | "degraded";
  markdown?: string | null;
  failure?: {
    type?: "pr_markdown_refresh_failure";
    code?: string;
    stage?: "preflight" | "fetch" | "rev-parse" | "diff" | "semantic-diff" | "mixed";
    stageStatuses?: {
      nameStatusDiff?: "succeeded" | "failed" | "not_run";
      semanticDiff?: "succeeded" | "failed" | "not_run";
    };
    summary?: string;
    remediationCommands?: string[];
    guidanceCategory?: "environment_fix" | "fetch_retry" | "local_history_remediation";
    commandSuggestions?: string[];
    command?: {
      gitSubcommand?: "version" | "rev-parse" | "fetch" | "diff";
      subcommand?: string;
      stageId?: "preflight" | "fetch" | "rev_parse" | "name_status_diff" | "semantic_diff_numstat";
      stderr?: string;
      exitCode?: number | null;
      stderrExcerpt?: string;
      reproduce?: string[];
    };
  };
  diagnostics?: Array<{
    code?: string;
    summary?: string;
    remediationCommands?: string[];
    message?: string;
    hints?: string[];
    guidance?: {
      category?: "environment_fix" | "fetch_retry" | "local_history_remediation";
      summary?: string;
      commands?: string[];
    };
  }>;
}

const COPY_FEEDBACK_MS = 2000;
const PR_MARKDOWN_MODE_STORAGE_KEY = "sv:pr-markdown:view-mode";

type PRMarkdownViewMode = "preview" | "raw";

type CopyState = "idle" | "success" | "error";
type CopyErrorKind = "permission-denied" | "generic" | null;

function parseStoredViewMode(value: string | null): PRMarkdownViewMode {
  return value === "raw" ? "raw" : "preview";
}

function readStoredViewMode(): PRMarkdownViewMode {
  if (typeof window === "undefined") return "preview";
  try {
    return parseStoredViewMode(window.sessionStorage.getItem(PR_MARKDOWN_MODE_STORAGE_KEY));
  } catch {
    return "preview";
  }
}

function persistViewMode(mode: PRMarkdownViewMode) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(PR_MARKDOWN_MODE_STORAGE_KEY, mode);
  } catch {
    // Ignore write errors (e.g. privacy modes) and keep in-memory state.
  }
}

function parseMarkdownPayload(markdown: string | null | undefined): string | null {
  if (typeof markdown !== "string") return null;
  return markdown.trim().length > 0 ? markdown : null;
}

function formatDiagnosticCode(code: string | undefined): string {
  if (!code) return "Unknown refresh issue";
  switch (code) {
    case "NOT_A_REPO":
      return "Repository not detected";
    case "MISSING_BASE_REF":
      return "Base branch could not be resolved";
    case "FETCH_DENIED":
      return "Remote authentication failed";
    case "NETWORK_DNS_ERROR":
      return "Remote host is unreachable";
    case "DETACHED_HEAD":
      return "Detached HEAD detected";
    case "SHALLOW_CLONE":
      return "Shallow clone detected";
    case "missing_git":
      return "Git is unavailable";
    case "not_repo":
      return "Repository not detected";
    case "unresolved_main_or_origin_main":
      return "Base branch could not be resolved";
    case "auth_fetch_denied":
      return "Remote authentication failed";
    case "network_dns_error":
      return "Remote host is unreachable";
    case "fetch_failed":
      return "Fetching base branch failed";
    case "rev_parse_failed":
      return "Failed to resolve base revision";
    case "diff_failed":
      return "Diff computation failed";
    default:
      return code.replaceAll("_", " ");
  }
}

function formatGuidanceCategory(category: "environment_fix" | "fetch_retry" | "local_history_remediation" | undefined): string {
  switch (category) {
    case "fetch_retry":
      return "Retry guidance: remote fetch";
    case "local_history_remediation":
      return "Remediation guidance: local history";
    case "environment_fix":
      return "Remediation guidance: environment";
    default:
      return "Remediation guidance";
  }
}

function isClassifiedPreflightCode(code: string | undefined): boolean {
  return code === "NOT_A_REPO"
    || code === "MISSING_BASE_REF"
    || code === "FETCH_DENIED"
    || code === "NETWORK_DNS_ERROR"
    || code === "DETACHED_HEAD"
    || code === "SHALLOW_CLONE";
}

function formatLastRefresh(ts: string | null): string {
  return `Last refreshed: ${formatCachedTimestamp(ts) ?? "Not refreshed yet"}`;
}

function formatCachedTimestamp(ts: string | null): string | null {
  if (!ts) return null;
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return null;
  const formatted = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }).format(date);
  return `${formatted} UTC`;
}

function formatStaleDuration(ms: number | null): string {
  if (!ms || ms <= 0) return "the freshness window";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.round(minutes / 60);
  return `${hours} hour${hours === 1 ? "" : "s"}`;
}

function fallbackCopyText(text: string): boolean {
  try {
    const input = document.createElement("textarea");
    input.value = text;
    input.style.position = "fixed";
    input.style.opacity = "0";
    document.body.appendChild(input);
    input.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(input);
    return ok;
  } catch {
    return false;
  }
}

function isPermissionDeniedClipboardError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === "NotAllowedError"
    || /permission/i.test(error.message)
    || /denied/i.test(error.message);
}

function renderMarkdownPreview(markdown: string) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: ComponentChildren[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();

    if (!trimmed) {
      i += 1;
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = headingMatch[2].trim();
      const tag = `h${level}` as keyof HTMLElementTagNameMap;
      blocks.push(h(tag, { class: "pr-markdown-preview-heading", key: `h-${key += 1}` }, text));
      i += 1;
      continue;
    }

    if (/^```/.test(trimmed)) {
      const langMatch = trimmed.match(/^```([\w-]+)?\s*$/);
      const language = langMatch?.[1] ?? "";
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !/^```/.test((lines[i] ?? "").trim())) {
        codeLines.push(lines[i] ?? "");
        i += 1;
      }
      if (i < lines.length) i += 1;
      blocks.push(
        h("pre", { class: "pr-markdown-preview-code", key: `c-${key += 1}` },
          h("code", { class: language ? `language-${language}` : undefined }, codeLines.join("\n")),
        ),
      );
      continue;
    }

    const unorderedMatch = line.match(/^[-*+]\s+(.+)$/);
    if (unorderedMatch) {
      const items: ComponentChildren[] = [];
      while (i < lines.length) {
        const candidate = lines[i] ?? "";
        const match = candidate.match(/^[-*+]\s+(.+)$/);
        if (!match) break;
        items.push(h("li", { key: `ul-item-${key += 1}` }, match[1].trim()));
        i += 1;
      }
      blocks.push(h("ul", { class: "pr-markdown-preview-list", key: `ul-${key += 1}` }, items));
      continue;
    }

    const orderedMatch = line.match(/^\d+\.\s+(.+)$/);
    if (orderedMatch) {
      const items: ComponentChildren[] = [];
      while (i < lines.length) {
        const candidate = lines[i] ?? "";
        const match = candidate.match(/^\d+\.\s+(.+)$/);
        if (!match) break;
        items.push(h("li", { key: `ol-item-${key += 1}` }, match[1].trim()));
        i += 1;
      }
      blocks.push(h("ol", { class: "pr-markdown-preview-list", key: `ol-${key += 1}` }, items));
      continue;
    }

    const paragraphLines: string[] = [];
    while (i < lines.length) {
      const candidate = lines[i] ?? "";
      const candidateTrimmed = candidate.trim();
      if (!candidateTrimmed || /^(#{1,6})\s+/.test(candidate) || /^```/.test(candidateTrimmed) || /^[-*+]\s+/.test(candidate) || /^\d+\.\s+/.test(candidate)) {
        break;
      }
      paragraphLines.push(candidateTrimmed);
      i += 1;
    }
    blocks.push(h("p", { class: "pr-markdown-preview-paragraph", key: `p-${key += 1}` }, paragraphLines.join(" ")));
  }

  return blocks;
}

export function PRMarkdownView() {
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [availability, setAvailability] = useState<"ready" | "unsupported" | "no-repo" | "error">("ready");
  const [message, setMessage] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [baseRange, setBaseRange] = useState<string | null>(null);
  const [cacheStatus, setCacheStatus] = useState<"missing" | "fresh" | "stale">("missing");
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [staleAfterMs, setStaleAfterMs] = useState<number | null>(null);
  const [latestSignature, setLatestSignature] = useState<string | null>(null);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const [copyErrorKind, setCopyErrorKind] = useState<CopyErrorKind>(null);
  const [viewMode, setViewMode] = useState<PRMarkdownViewMode>(() => readStoredViewMode());
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [refreshDiagnostics, setRefreshDiagnostics] = useState<Array<{
    code?: string;
    summary?: string;
    remediationCommands?: string[];
    message?: string;
    hints?: string[];
    guidance?: {
      category?: "environment_fix" | "fetch_retry" | "local_history_remediation";
      summary?: string;
      commands?: string[];
    };
  }> | null>(null);
  const [refreshFailure, setRefreshFailure] = useState<PRMarkdownRefreshResponse["failure"] | null>(null);
  const inFlightRef = useRef(false);
  const hasLoadedRef = useRef(false);
  const loadedMarkdownSignatureRef = useRef<string | null>(null);
  const hasSuccessfulMarkdownRef = useRef(false);
  const copyFeedbackTimerRef = useRef<number | null>(null);

  const loadMarkdown = useCallback(async (): Promise<string | null> => {
    const res = await fetch("/api/sv/pr-markdown");
    if (!res.ok) throw new Error(`Failed to load PR markdown (${res.status})`);
    const json = await res.json() as PRMarkdownResponse;
    return parseMarkdownPayload(json.markdown);
  }, []);

  const applyStatePayload = useCallback((json: PRMarkdownStateResponse) => {
    const nextAvailability = json.availability ?? "ready";
    const nextMessage = typeof json.message === "string" ? json.message : null;
    const nextWarning = typeof json.warning === "string" ? json.warning : null;
    const nextBaseRange = typeof json.baseRange === "string" && json.baseRange.length > 0 ? json.baseRange : null;
    const nextSignature = typeof json.signature === "string" && json.signature.length > 0
      ? json.signature
      : `${nextAvailability}:unknown`;
    const nextCacheStatus = json.cacheStatus ?? "missing";
    const nextGeneratedAt = typeof json.generatedAt === "string" && json.generatedAt.length > 0 ? json.generatedAt : null;
    const nextStaleAfterMs = typeof json.staleAfterMs === "number" && Number.isFinite(json.staleAfterMs)
      ? Math.max(0, json.staleAfterMs)
      : null;

    setAvailability(nextAvailability);
    setMessage(nextMessage);
    setWarning(nextWarning);
    setBaseRange(nextBaseRange);
    setLatestSignature(nextSignature);
    setCacheStatus(nextCacheStatus);
    setGeneratedAt(nextGeneratedAt);
    setStaleAfterMs(nextStaleAfterMs);
    setLastRefreshedAt(nextGeneratedAt);

    return { availability: nextAvailability, signature: nextSignature };
  }, []);

  const refreshFromState = useCallback(async (forceMarkdownFetch: boolean = false) => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    if (!hasLoadedRef.current) setLoading(true);
    setError(null);
    setRefreshError(null);
    setRefreshDiagnostics(null);
    setRefreshFailure(null);
    try {
      const res = await fetch("/api/sv/pr-markdown/state");
      if (!res.ok) throw new Error(`Failed to load PR markdown state (${res.status})`);
      const json = await res.json() as PRMarkdownStateResponse;
      const nextState = applyStatePayload(json);

      if (nextState.availability !== "ready") {
        loadedMarkdownSignatureRef.current = null;
        hasSuccessfulMarkdownRef.current = false;
        setMarkdown(null);
        hasLoadedRef.current = true;
        return;
      }

      if (forceMarkdownFetch || loadedMarkdownSignatureRef.current !== nextState.signature) {
        const nextMarkdown = await loadMarkdown();
        setMarkdown(nextMarkdown);
        hasSuccessfulMarkdownRef.current = nextMarkdown !== null;
        loadedMarkdownSignatureRef.current = nextState.signature;
      }
      hasLoadedRef.current = true;
    } catch (err) {
      const nextMessage = err instanceof Error ? err.message : "Failed to load PR markdown";
      if (hasLoadedRef.current && hasSuccessfulMarkdownRef.current) {
        setRefreshError(nextMessage);
      } else {
        setError(nextMessage);
      }
    } finally {
      setLoading(false);
      inFlightRef.current = false;
    }
  }, [applyStatePayload, loadMarkdown]);

  const refreshManually = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setIsRefreshing(true);
    setError(null);
    setRefreshError(null);
    setRefreshDiagnostics(null);
    setRefreshFailure(null);
    try {
      const res = await fetch("/api/sv/pr-markdown/refresh", { method: "POST" });
      if (!res.ok) throw new Error(`Failed to refresh PR markdown (${res.status})`);
      const json = await res.json() as PRMarkdownRefreshResponse;
      const nextState = applyStatePayload(json);
      const nextDiagnostics = Array.isArray(json.diagnostics)
        ? json.diagnostics.filter((entry) => {
            if (!entry) return false;
            if (typeof entry.message === "string" && entry.message.length > 0) return true;
            if (typeof entry.summary === "string" && entry.summary.length > 0) return true;
            if (typeof entry.code === "string" && entry.code.length > 0) return true;
            if (typeof entry.guidance?.summary === "string" && entry.guidance.summary.length > 0) return true;
            if (Array.isArray(entry.guidance?.commands) && entry.guidance.commands.length > 0) return true;
            return Array.isArray(entry.hints) && entry.hints.length > 0;
          })
        : [];
      setRefreshDiagnostics(nextDiagnostics.length > 0 ? nextDiagnostics : null);
      const nextFailure = json.failure && json.failure.type === "pr_markdown_refresh_failure"
        ? json.failure
        : null;
      setRefreshFailure(nextFailure);

      if (nextState.availability !== "ready") {
        loadedMarkdownSignatureRef.current = null;
        hasSuccessfulMarkdownRef.current = false;
        setMarkdown(null);
        hasLoadedRef.current = true;
        return;
      }

      const refreshMarkdown = parseMarkdownPayload(json.markdown);
      const nextMarkdown = refreshMarkdown ?? await loadMarkdown();
      setMarkdown(nextMarkdown);
      hasSuccessfulMarkdownRef.current = nextMarkdown !== null;
      loadedMarkdownSignatureRef.current = nextState.signature;
      hasLoadedRef.current = true;
    } catch (err) {
      const nextMessage = err instanceof Error ? err.message : "Failed to refresh PR markdown";
      if (hasLoadedRef.current && hasSuccessfulMarkdownRef.current) {
        setRefreshError(nextMessage);
      } else {
        setError(nextMessage);
      }
    } finally {
      setIsRefreshing(false);
      setLoading(false);
      inFlightRef.current = false;
    }
  }, [applyStatePayload, loadMarkdown]);

  const setCopyFeedback = useCallback((nextState: CopyState) => {
    setCopyState(nextState);
    if (copyFeedbackTimerRef.current !== null) {
      window.clearTimeout(copyFeedbackTimerRef.current);
      copyFeedbackTimerRef.current = null;
    }
    if (nextState !== "idle") {
      copyFeedbackTimerRef.current = window.setTimeout(() => {
        setCopyState("idle");
        copyFeedbackTimerRef.current = null;
      }, COPY_FEEDBACK_MS);
    }
  }, []);

  const handleCopyRawMarkdown = useCallback(async () => {
    if (!markdown) return;
    try {
      await navigator.clipboard.writeText(markdown);
      setCopyErrorKind(null);
      setCopyFeedback("success");
    } catch (error) {
      if (fallbackCopyText(markdown)) {
        setCopyErrorKind(null);
        setCopyFeedback("success");
        return;
      }
      setCopyErrorKind(isPermissionDeniedClipboardError(error) ? "permission-denied" : "generic");
      setCopyFeedback("error");
    }
  }, [markdown, setCopyFeedback]);

  const handleModeChange = useCallback((mode: PRMarkdownViewMode) => {
    setViewMode(mode);
    persistViewMode(mode);
  }, []);

  useEffect(() => {
    void refreshFromState();
    return () => {
      if (copyFeedbackTimerRef.current !== null) {
        window.clearTimeout(copyFeedbackTimerRef.current);
      }
    };
  }, [refreshFromState]);

  useEffect(() => {
    setCopyState("idle");
    setCopyErrorKind(null);
  }, [markdown]);

  const copyFeedbackMessage = copyState === "success"
    ? "Copied markdown to clipboard."
    : copyState === "error"
      ? copyErrorKind === "permission-denied"
        ? "Clipboard access was blocked by browser permissions. Copy manually: select the markdown and press Cmd+C (macOS) or Ctrl+C (Windows/Linux)."
        : "Failed to copy markdown to clipboard. Copy manually: select the markdown and press Cmd+C (macOS) or Ctrl+C (Windows/Linux)."
      : "";
  const fallbackTitle = availability === "unsupported"
    ? "Git is unavailable"
    : availability === "no-repo"
      ? "No git repository detected"
      : availability === "error"
        ? "Unable to inspect git state"
        : "";
  const hasRefreshDiagnostics = !loading && !error && availability === "ready" && Array.isArray(refreshDiagnostics) && refreshDiagnostics.length > 0;
  const hasSemanticDiffFailure = hasRefreshDiagnostics
    && (refreshFailure?.stage === "semantic-diff"
      || refreshFailure?.stage === "mixed"
      || refreshFailure?.stageStatuses?.semanticDiff === "failed");
  const hasPreflightRefreshDiagnostics = hasRefreshDiagnostics && refreshDiagnostics.some((entry) => isClassifiedPreflightCode(entry.code));
  const showFailureDetails = !!refreshFailure && !hasPreflightRefreshDiagnostics;
  const failureSubcommand = refreshFailure?.command?.subcommand
    ?? (refreshFailure?.command?.gitSubcommand ? `git ${refreshFailure.command.gitSubcommand}` : null);
  const failureStderrExcerpt = typeof refreshFailure?.command?.stderrExcerpt === "string"
    && refreshFailure.command.stderrExcerpt.length > 0
    ? refreshFailure.command.stderrExcerpt
    : null;

  return h("div", { class: "pr-markdown-container" },
    h("div", { class: "view-header" },
      h(BrandedHeader, { product: "sourcevision", title: "SourceVision", class: "branded-header-sv" }),
      h("h2", { class: "section-header" }, "PR Markdown"),
    ),
    h("p", { class: "section-sub" },
      "Latest PR-ready markdown generated from current repository state.",
    ),
    h("p", { class: "section-sub pr-markdown-refreshed-at", role: "status", "aria-live": "polite" },
      formatLastRefresh(lastRefreshedAt),
    ),
    h("div", null,
      h("button", {
        type: "button",
        class: "btn pr-markdown-refresh-btn",
        onClick: () => { void refreshManually(); },
        disabled: loading || isRefreshing,
      }, isRefreshing ? "Refreshing..." : "Refresh"),
    ),

    loading
      ? h("div", { class: "loading", role: "status", "aria-live": "polite" }, "Loading PR markdown...")
      : null,

    !loading && refreshError
      ? h("div", { class: "card pr-markdown-refresh-error", role: "status", "aria-live": "polite" },
          h("h3", { class: "section-header-sm" }, "Refresh failed"),
          h("p", null, refreshError),
          h("p", null, "Last successful PR markdown is still shown below."),
          h("button", { type: "button", class: "btn pr-markdown-retry-btn", onClick: () => { void refreshManually(); } }, "Retry refresh"),
        )
      : null,

    !loading && error
      ? h("div", { class: "card pr-markdown-empty" },
          h("h3", { class: "section-header-sm" }, "Unable to load PR markdown"),
          h("p", null, error),
          h("button", { type: "button", class: "btn pr-markdown-retry-btn", onClick: () => { void refreshManually(); } }, "Retry"),
        )
      : null,

    !loading && !error && availability !== "ready"
      ? h("div", { class: "card pr-markdown-empty", role: "status", "aria-live": "polite" },
          h("h3", { class: "section-header-sm" }, fallbackTitle),
          h("p", null, message ?? "PR markdown is unavailable in this environment."),
        )
      : null,

    hasSemanticDiffFailure
      ? h("div", { class: "card pr-markdown-warning pr-markdown-degraded-banner", role: "status", "aria-live": "polite" },
          h("h3", { class: "section-header-sm" }, "Semantic diff refresh failed"),
          h("p", null, "Cached PR markdown is shown below so you can continue reviewing and copying content."),
          h("p", { class: "section-sub pr-markdown-warning-meta" },
            `Stage: ${refreshFailure?.stage ?? "unknown"} | Base range: ${baseRange ?? "unresolved"}`,
          ),
        )
      : null,

    hasRefreshDiagnostics
      ? h("div", { class: "card pr-markdown-warning", role: "status", "aria-live": "polite" },
          h("h3", { class: "section-header-sm" }, "Refresh diagnostics"),
          h("p", null, "Manual refresh completed with limitations. Cached PR markdown is still shown below."),
          warning
            ? h("p", null, warning)
            : null,
          message
            ? h("p", null, message)
            : null,
          showFailureDetails
            ? h("div", { class: "pr-markdown-failure-details" },
                h("p", { class: "pr-markdown-failure-details-heading" }, "Failure details"),
                failureSubcommand
                  ? h("p", { class: "pr-markdown-failure-command" }, `Failing git subcommand: ${failureSubcommand}`)
                  : null,
                failureStderrExcerpt
                  ? h("pre", { class: "pr-markdown-failure-stderr" }, failureStderrExcerpt)
                  : null,
              )
            : null,
          h("div", { class: "pr-markdown-diagnostics" },
            refreshDiagnostics.map((entry, index) => h("div", { class: "pr-markdown-diagnostic-item", key: `${entry.code ?? "unknown"}-${index}` },
              h("p", { class: "pr-markdown-diagnostic-code" }, formatDiagnosticCode(entry.code)),
              typeof entry.message === "string" && entry.message.length > 0 && !isClassifiedPreflightCode(entry.code)
                ? h("p", { class: "pr-markdown-diagnostic-message" }, entry.message)
                : null,
              typeof entry.summary === "string" && entry.summary.length > 0
                ? h("p", { class: "pr-markdown-diagnostic-guidance-summary" }, entry.summary)
                : null,
              entry.guidance
                ? h("div", { class: "pr-markdown-diagnostic-guidance" },
                    h("p", { class: "pr-markdown-diagnostic-guidance-category" }, formatGuidanceCategory(entry.guidance.category)),
                    typeof entry.guidance.summary === "string" && entry.guidance.summary.length > 0
                      ? h("p", { class: "pr-markdown-diagnostic-guidance-summary" }, entry.guidance.summary)
                      : null,
                    Array.isArray(entry.guidance.commands) && entry.guidance.commands.length > 0
                      ? h("ul", { class: "pr-markdown-diagnostic-guidance-commands" },
                          entry.guidance.commands.map((command, commandIndex) => h("li", { key: `${commandIndex}` }, command)),
                        )
                      : null,
                  )
                : null,
              Array.isArray(entry.hints) && entry.hints.length > 0
                ? h("ul", { class: "pr-markdown-diagnostic-hints" },
                    entry.hints.map((hint, hintIndex) => h("li", { key: `${hintIndex}` }, hint)),
                  )
                : null,
              Array.isArray(entry.remediationCommands) && entry.remediationCommands.length > 0
                ? h("ul", { class: "pr-markdown-diagnostic-guidance-commands" },
                    entry.remediationCommands.map((command, commandIndex) => h("li", { key: `rem-${commandIndex}` }, command)),
                  )
                : null,
            )),
          ),
          h("p", { class: "section-sub pr-markdown-warning-meta" },
            `Base range: ${baseRange ?? "unresolved"} | Signature: ${latestSignature ? latestSignature.slice(0, 12) : "unknown"}`,
          ),
        )
      : null,

    !hasRefreshDiagnostics && !loading && !error && warning
      ? h("div", { class: "card pr-markdown-warning", role: "status", "aria-live": "polite" },
          h("h3", { class: "section-header-sm" }, "Partial git metadata only"),
          h("p", null, warning),
          h("p", null, message ?? "PR markdown generation is degraded."),
          h("p", { class: "section-sub pr-markdown-warning-meta" },
            `Base range: ${baseRange ?? "unresolved"} | Signature: ${latestSignature ? latestSignature.slice(0, 12) : "unknown"}`,
          ),
        )
      : null,

    !loading && !error && availability === "ready" && !markdown
      ? h("div", { class: "card pr-markdown-empty", role: "status", "aria-live": "polite" },
          h("h3", { class: "section-header-sm" }, "PR markdown has not been generated yet"),
          h("p", null, "No cached PR markdown artifact was found for this repository."),
          h("p", null, "Click Refresh to generate and cache PR markdown."),
        )
      : null,

    !loading && !error && availability === "ready" && cacheStatus === "stale" && markdown
      ? h("div", { class: "card pr-markdown-warning", role: "status", "aria-live": "polite" },
          h("h3", { class: "section-header-sm" }, "Cached PR markdown is stale"),
          h("p", null, `This cached artifact is older than ${formatStaleDuration(staleAfterMs)}.`),
          h("p", null, "Use Refresh to regenerate it before publishing your PR description."),
          h("p", { class: "section-sub pr-markdown-warning-meta" },
            `Generated at: ${formatCachedTimestamp(generatedAt) ?? "unknown"}`,
          ),
        )
      : null,

    !loading && !error && markdown
      ? h("div", { class: "card pr-markdown-success", role: "status", "aria-live": "polite" },
          h("h3", { class: "section-header-sm" }, "PR markdown ready"),
          h("div", { class: "pr-markdown-mode-toggle", role: "group", "aria-label": "PR markdown view mode" },
            h("button", {
              type: "button",
              class: `toggle-btn${viewMode === "preview" ? " active" : ""}`,
              "aria-pressed": String(viewMode === "preview"),
              "aria-controls": "pr-markdown-panel-preview",
              onClick: () => handleModeChange("preview"),
            }, "Preview"),
            h("button", {
              type: "button",
              class: `toggle-btn${viewMode === "raw" ? " active" : ""}`,
              "aria-pressed": String(viewMode === "raw"),
              "aria-controls": "pr-markdown-panel-raw",
              onClick: () => handleModeChange("raw"),
            }, "Raw"),
          ),
          viewMode === "preview"
            ? h("section", { class: "pr-markdown-panel", id: "pr-markdown-panel-preview" },
                h("h4", { class: "section-header-sm" }, "Preview"),
                h("div", { class: "pr-markdown-preview" }, renderMarkdownPreview(markdown)),
              )
            : h("section", { class: "pr-markdown-panel", id: "pr-markdown-panel-raw" },
                h("div", { class: "pr-markdown-raw-header" },
                  h("h4", { class: "section-header-sm" }, "Raw Markdown"),
                  h("button", {
                    type: "button",
                    class: "btn pr-markdown-copy-btn",
                    onClick: () => { void handleCopyRawMarkdown(); },
                  }, copyState === "success" ? "Copied" : "Copy Markdown"),
                ),
                h("pre", { class: "pr-markdown-raw" }, markdown),
                h("p", { class: "section-sub pr-markdown-copy-feedback", role: "status", "aria-live": "polite" },
                  copyFeedbackMessage,
                ),
              ),
        )
      : null,
  );
}
