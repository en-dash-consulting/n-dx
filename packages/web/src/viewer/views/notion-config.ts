/**
 * Notion section — Notion API credentials and connection, as the Project page
 * renders them (only while `rex.notionSync` is on).
 *
 * The credentials are the form (`useNotionForm`): the page's Save writes them.
 * Test connection, Sync and Remove Configuration are immediate actions; they
 * never change whether the form is dirty, and Remove is held back while the
 * form has unsaved edits so it cannot discard them silently.
 *
 * Data comes from:
 *   GET    /api/notion/config  — current config (masked token)
 *   PUT    /api/notion/config  — save credentials
 *   POST   /api/notion/test    — test connection
 *   DELETE /api/notion/config  — remove config
 */

import { h, Fragment } from "preact";
import { useState, useEffect, useCallback } from "preact/hooks";
import { NotionSchemaWizard } from "../components/index.js";

// ── Types ────────────────────────────────────────────────────────────

interface NotionConfig {
  configured: boolean;
  token: string | null;
  databaseId: string | null;
  tokenMasked: string | null;
  tokenEnvVar: string | null;
}

interface ConnectionTestResult {
  status: "green" | "yellow" | "red";
  message: string;
  details?: {
    authValid: boolean;
    databaseAccessible: boolean;
    databaseTitle?: string;
    pageCount?: number;
  };
}

interface ValidationErrors {
  token?: string;
  databaseId?: string;
}

// ── Validation helpers ───────────────────────────────────────────────

function validateApiKeyFormat(token: string): string | null {
  if (!token || token.trim().length === 0) return "API key is required";
  const trimmed = token.trim();
  if (!trimmed.startsWith("secret_") && !trimmed.startsWith("ntn_")) {
    return "API key must start with 'secret_' or 'ntn_'";
  }
  if (trimmed.length < 20) return "API key appears too short";
  return null;
}

function validateDatabaseIdFormat(id: string): string | null {
  if (!id || id.trim().length === 0) return "Database ID is required";
  const trimmed = id.trim().replace(/-/g, "");
  if (!/^[0-9a-f]{32}$/i.test(trimmed)) {
    return "Database ID must be a valid UUID (32 hex characters)";
  }
  return null;
}

// ── Form state ───────────────────────────────────────────────────────

/** State and actions of the Notion form. The Project page owns it. */
export interface NotionForm {
  config: NotionConfig | null;
  loading: boolean;
  /** Why the config could not be loaded. */
  loadError: string | null;
  /** Why the last save failed. Cleared by the next save or a discard. */
  saveError: string | null;
  /** Why the last immediate action (remove) failed. */
  actionError: string | null;
  token: string;
  databaseId: string;
  tokenVisible: boolean;
  fieldErrors: ValidationErrors;
  testing: boolean;
  testResult: ConnectionTestResult | null;
  confirmRemove: boolean;
  removing: boolean;
  /** True while a token is typed, or the database ID differs from the saved one. */
  dirty: boolean;
  onTokenChange: (value: string) => void;
  onDatabaseIdChange: (value: string) => void;
  toggleTokenVisible: () => void;
  /** POST the current form values to /api/notion/test. Not an edit. */
  test: () => Promise<void>;
  setConfirmRemove: (confirm: boolean) => void;
  /** DELETE the saved config and reset the form. Not an edit. */
  remove: () => Promise<void>;
  /**
   * PUT the credentials to /api/notion/config. Resolves true once saved (or
   * when nothing is dirty); false leaves the edits in place with an error set.
   */
  save: () => Promise<boolean>;
  /** Drop the typed token and restore the saved database ID. */
  discard: () => void;
}

/**
 * @param enabled False while `rex.notionSync` is off: nothing is fetched and the
 *   form stays clean, so a hidden section can never hold the page dirty.
 */
export function useNotionForm(enabled: boolean): NotionForm {
  const [loading, setLoading] = useState(true);
  const [config, setConfig] = useState<NotionConfig | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [token, setToken] = useState("");
  const [databaseId, setDatabaseId] = useState("");
  const [tokenVisible, setTokenVisible] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<ValidationErrors>({});

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);

  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);

  const fetchConfig = useCallback(async () => {
    try {
      const res = await fetch("/api/notion/config");
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Failed to load" }));
        setLoadError((body as { error?: string }).error ?? "Failed to load configuration");
        return;
      }
      const data = await res.json() as NotionConfig;
      setConfig(data);
      setLoadError(null);
      // The token is never returned in plain text; its field stays empty.
      setDatabaseId(data.databaseId ?? "");
      setToken("");
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load configuration");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (enabled) void fetchConfig();
  }, [enabled, fetchConfig]);

  const savedDatabaseId = config?.databaseId ?? "";
  const dirty = enabled
    && (token.trim().length > 0
      || (databaseId.trim().length > 0 && databaseId.trim() !== savedDatabaseId));

  const onTokenChange = useCallback((value: string) => {
    setToken(value);
    const err = value.trim().length > 0 ? validateApiKeyFormat(value) : null;
    setFieldErrors((prev) => ({ ...prev, token: err ?? undefined }));
  }, []);

  const onDatabaseIdChange = useCallback((value: string) => {
    setDatabaseId(value);
    const err = value.trim().length > 0 ? validateDatabaseIdFormat(value) : null;
    setFieldErrors((prev) => ({ ...prev, databaseId: err ?? undefined }));
  }, []);

  const toggleTokenVisible = useCallback(() => setTokenVisible((v) => !v), []);

  const save = useCallback(async (): Promise<boolean> => {
    if (!dirty) return true;
    setSaveError(null);

    const payload: Record<string, string> = {};
    if (token.trim().length > 0) {
      const tokenErr = validateApiKeyFormat(token);
      if (tokenErr) {
        setFieldErrors((prev) => ({ ...prev, token: tokenErr }));
        setSaveError("Fix the highlighted Notion fields before saving");
        return false;
      }
      payload.token = token.trim();
    }
    if (databaseId.trim().length > 0) {
      const dbErr = validateDatabaseIdFormat(databaseId);
      if (dbErr) {
        setFieldErrors((prev) => ({ ...prev, databaseId: dbErr }));
        setSaveError("Fix the highlighted Notion fields before saving");
        return false;
      }
      payload.databaseId = databaseId.trim();
    }

    try {
      const res = await fetch("/api/notion/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Save failed" })) as
          { error?: string; errors?: ValidationErrors };
        if (body.errors) setFieldErrors(body.errors);
        setSaveError(body.error ?? "Notion configuration was not saved");
        return false;
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed");
      return false;
    }

    // The token is redacted on disk now; clear the field and show what was stored.
    setTokenVisible(false);
    setFieldErrors({});
    await fetchConfig();
    return true;
  }, [dirty, token, databaseId, fetchConfig]);

  const discard = useCallback(() => {
    setToken("");
    setTokenVisible(false);
    setDatabaseId(savedDatabaseId);
    setFieldErrors({});
    setSaveError(null);
  }, [savedDatabaseId]);

  const test = useCallback(async () => {
    setTesting(true);
    setTestResult(null);
    try {
      // Test the form as it stands, saved or not.
      const payload: Record<string, string> = {};
      if (token.trim().length > 0) payload.token = token.trim();
      if (databaseId.trim().length > 0) payload.databaseId = databaseId.trim();

      const res = await fetch("/api/notion/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        setTestResult({ status: "red", message: "Connection test request failed" });
        return;
      }
      setTestResult(await res.json() as ConnectionTestResult);
    } catch (err) {
      setTestResult({
        status: "red",
        message: err instanceof Error ? err.message : "Connection test failed",
      });
    } finally {
      setTesting(false);
    }
  }, [token, databaseId]);

  const remove = useCallback(async () => {
    setRemoving(true);
    setActionError(null);
    try {
      const res = await fetch("/api/notion/config", { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Remove failed" }));
        setActionError((body as { error?: string }).error ?? "Remove failed");
        return;
      }
      setTestResult(null);
      setConfirmRemove(false);
      await fetchConfig();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Remove failed");
    } finally {
      setRemoving(false);
    }
  }, [fetchConfig]);

  return {
    config, loading, loadError, saveError, actionError,
    token, databaseId, tokenVisible, fieldErrors,
    testing, testResult, confirmRemove, removing,
    dirty,
    onTokenChange, onDatabaseIdChange, toggleTokenVisible,
    test, setConfirmRemove, remove,
    save, discard,
  };
}

// ── Status indicator component ───────────────────────────────────────

function ConnectionStatus({ result, testing }: {
  result: ConnectionTestResult | null;
  testing: boolean;
}) {
  if (testing) {
    return h("div", { class: "notion-status notion-status-testing" },
      h("span", { class: "notion-status-dot notion-status-dot-testing" }),
      h("span", { class: "notion-status-text" }, "Testing connection..."),
    );
  }

  if (!result) {
    return h("div", { class: "notion-status notion-status-unknown" },
      h("span", { class: "notion-status-dot notion-status-dot-unknown" }),
      h("span", { class: "notion-status-text" }, "Not tested"),
    );
  }

  const dotClass = `notion-status-dot notion-status-dot-${result.status}`;

  return h("div", { class: `notion-status notion-status-${result.status}` },
    h("span", { class: dotClass }),
    h("div", { class: "notion-status-info" },
      h("span", { class: "notion-status-text" }, result.message),
      result.details?.databaseTitle
        ? h("span", { class: "notion-status-detail" },
            `Database: ${result.details.databaseTitle}`,
          )
        : null,
    ),
  );
}

// ── Environment variable hint ────────────────────────────────────────

function EnvVarHint({ envVar }: { envVar: string | null }) {
  if (!envVar) return null;

  return h("div", { class: "notion-env-hint" },
    h("span", { class: "notion-env-hint-icon" }, "\u{1F512}"),
    h("div", { class: "notion-env-hint-content" },
      h("p", { class: "notion-env-hint-title" }, "Credential stored securely"),
      h("p", { class: "notion-env-hint-desc" },
        "The API key is redacted on disk. Set the environment variable at runtime:",
      ),
      h("code", { class: "notion-env-hint-code" },
        `export ${envVar}="your-token"`,
      ),
    ),
  );
}

// ── Sync Panel ───────────────────────────────────────────────────────

function SyncPanel() {
  const [syncState, setSyncState] = useState<"idle" | "running" | "done" | "error">("idle");
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  const handleSync = useCallback(async (direction: "push" | "pull" | "sync") => {
    setSyncState("running");
    setSyncResult(null);
    setSyncError(null);
    try {
      const res = await fetch("/api/commands/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ direction }),
      });
      const data = await res.json() as Record<string, unknown>;
      if (!res.ok) {
        throw new Error((data.error as string) || `HTTP ${res.status}`);
      }
      setSyncResult((data.output as string) || `Sync (${direction}) complete.`);
      setSyncState("done");
    } catch (err) {
      setSyncError(String(err));
      setSyncState("error");
    }
  }, []);

  return h("div", { class: "notion-config-section" },
    h("h3", { class: "notion-config-section-title" },
      h("span", { class: "notion-config-section-icon" }, "\u{1F504}"),
      "Sync",
    ),
    h("p", { class: "notion-config-field-desc" },
      "Push local PRD changes to Notion, pull remote changes, or run a two-way sync.",
    ),
    h("div", { class: "cmd-sync-row" },
      h("button", {
        type: "button",
        class: "cmd-sync-btn",
        onClick: () => handleSync("push"),
        disabled: syncState === "running",
      },
        syncState === "running" ? h("span", { class: "cmd-inline-spinner", "aria-hidden": "true" }) : "↑",
        " Push",
      ),
      h("button", {
        type: "button",
        class: "cmd-sync-btn",
        onClick: () => handleSync("pull"),
        disabled: syncState === "running",
      },
        syncState === "running" ? h("span", { class: "cmd-inline-spinner", "aria-hidden": "true" }) : "↓",
        " Pull",
      ),
      h("button", {
        type: "button",
        class: "cmd-sync-btn",
        onClick: () => handleSync("sync"),
        disabled: syncState === "running",
      },
        syncState === "running" ? h("span", { class: "cmd-inline-spinner", "aria-hidden": "true" }) : "⇅",
        " Sync",
      ),
    ),
    syncResult
      ? h("div", { class: "cmd-sync-result cmd-sync-result-ok" }, syncResult)
      : null,
    syncError
      ? h("div", { class: "cmd-sync-result cmd-sync-result-err" }, syncError)
      : null,
  );
}

// ── Section ──────────────────────────────────────────────────────────

/** Why Remove is unavailable, shown beside the button. */
export const NOTION_REMOVE_BLOCKED_HINT = "Save or discard your Notion edits before removing the configuration.";

export function NotionSection({ form }: { form: NotionForm }) {
  const { config, fieldErrors } = form;

  if (form.loading) {
    return h("div", { class: "loading" }, "Loading Notion configuration...");
  }

  if (form.loadError && !config) {
    return h("div", { class: "notion-config-error-state" },
      h("p", null, form.loadError),
      h("p", { class: "notion-config-error-hint" },
        "Make sure ",
        h("code", null, ".rex/"),
        " exists. Run ",
        h("code", null, "rex init"),
        " to create it.",
      ),
    );
  }

  const isConfigured = config?.configured ?? false;
  const error = form.saveError ?? form.actionError;

  return h("div", { class: "notion-config-container" },
    h("p", { class: "notion-config-subtitle" },
      "Connect your PRD to a Notion database for two-way sync.",
    ),

    // ── Connection status
    h("div", { class: "notion-config-section" },
      h("h3", { class: "notion-config-section-title" },
        h("span", { class: "notion-config-section-icon" }, "\u{1F50C}"),
        "Connection Status",
      ),
      h(ConnectionStatus, { result: form.testResult, testing: form.testing }),
      isConfigured
        ? h(EnvVarHint, { envVar: config?.tokenEnvVar ?? null })
        : null,
    ),

    error
      ? h("div", { class: "notion-config-error-banner", role: "alert" }, error)
      : null,

    // ── Credentials
    h("div", { class: "notion-config-section" },
      h("h3", { class: "notion-config-section-title" },
        h("span", { class: "notion-config-section-icon" }, "\u{1F511}"),
        "Credentials",
      ),

      h("div", { class: `notion-config-field${fieldErrors.token ? " notion-config-field-error" : ""}` },
        h("label", { class: "notion-config-label", htmlFor: "notion-token" },
          "Notion API Key",
          isConfigured
            ? h("span", { class: "notion-config-badge" }, "configured")
            : null,
        ),
        h("p", { class: "notion-config-field-desc" },
          "Integration token from ",
          h("a", {
            href: "https://www.notion.so/my-integrations",
            target: "_blank",
            rel: "noopener noreferrer",
          }, "notion.so/my-integrations"),
          ". Starts with ",
          h("code", null, "secret_"),
          " or ",
          h("code", null, "ntn_"),
          ".",
        ),
        h("div", { class: "notion-config-input-row" },
          h("input", {
            id: "notion-token",
            type: form.tokenVisible ? "text" : "password",
            class: "notion-config-input",
            value: form.token,
            placeholder: isConfigured
              ? `Current: ${config?.tokenMasked ?? "****"}`
              : "secret_xxxxx or ntn_xxxxx",
            onInput: (e: Event) => form.onTokenChange((e.target as HTMLInputElement).value),
            autocomplete: "off",
            spellcheck: false,
          }),
          h("button", {
            type: "button",
            class: "notion-config-toggle-visibility",
            onClick: form.toggleTokenVisible,
            title: form.tokenVisible ? "Hide token" : "Show token",
            "aria-label": form.tokenVisible ? "Hide token" : "Show token",
          }, form.tokenVisible ? "\u{1F441}" : "\u{1F441}‍\u{1F5E8}"),
        ),
        fieldErrors.token
          ? h("div", { class: "notion-config-field-error-text" }, fieldErrors.token)
          : null,
      ),

      h("div", { class: `notion-config-field${fieldErrors.databaseId ? " notion-config-field-error" : ""}` },
        h("label", { class: "notion-config-label", htmlFor: "notion-database-id" },
          "Database ID",
          isConfigured && config?.databaseId
            ? h("span", { class: "notion-config-badge" }, "configured")
            : null,
        ),
        h("p", { class: "notion-config-field-desc" },
          "The UUID of your Notion database. Find it in the database URL: ",
          h("code", null, "notion.so/{workspace}/{database_id}?v=..."),
        ),
        h("input", {
          id: "notion-database-id",
          type: "text",
          class: "notion-config-input",
          value: form.databaseId,
          placeholder: "e.g. a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
          onInput: (e: Event) => form.onDatabaseIdChange((e.target as HTMLInputElement).value),
          autocomplete: "off",
          spellcheck: false,
        }),
        fieldErrors.databaseId
          ? h("div", { class: "notion-config-field-error-text" }, fieldErrors.databaseId)
          : null,
      ),
    ),

    // ── Immediate actions
    h("div", { class: "notion-config-actions" },
      h("div", { class: "notion-config-actions-primary" },
        h("button", {
          type: "button",
          class: "notion-config-test-btn",
          onClick: () => void form.test(),
          disabled: form.testing,
        }, form.testing ? "Testing..." : "Test Connection"),
      ),
      isConfigured
        ? h("div", { class: "notion-config-actions-danger" },
            form.confirmRemove
              ? h(Fragment, null,
                  h("span", { class: "notion-config-confirm-text" }, "Remove Notion config?"),
                  h("button", {
                    type: "button",
                    class: "notion-config-confirm-yes",
                    onClick: () => void form.remove(),
                    disabled: form.removing,
                  }, form.removing ? "Removing..." : "Yes, Remove"),
                  h("button", {
                    type: "button",
                    class: "notion-config-confirm-no",
                    onClick: () => form.setConfirmRemove(false),
                  }, "Cancel"),
                )
              : h(Fragment, null,
                  h("button", {
                    type: "button",
                    class: "notion-config-remove-btn",
                    onClick: () => form.setConfirmRemove(true),
                    disabled: form.dirty,
                    title: form.dirty ? NOTION_REMOVE_BLOCKED_HINT : undefined,
                  }, "Remove Configuration"),
                  form.dirty
                    ? h("span", { class: "notion-config-field-desc" }, NOTION_REMOVE_BLOCKED_HINT)
                    : null,
                ),
          )
        : null,
    ),

    // ── Schema validation wizard
    h("div", { class: "notion-config-section" },
      h(NotionSchemaWizard, { isConfigured }),
    ),

    // ── Sync panel (only when configured)
    isConfigured
      ? h(SyncPanel, null)
      : null,

    // ── Help section
    h("div", { class: "notion-config-section notion-config-help" },
      h("h3", { class: "notion-config-section-title" },
        h("span", { class: "notion-config-section-icon" }, "ℹ"),
        "Setup Guide",
      ),
      h("ol", { class: "notion-config-steps" },
        h("li", null,
          h("strong", null, "Create an integration"),
          " at ",
          h("a", {
            href: "https://www.notion.so/my-integrations",
            target: "_blank",
            rel: "noopener noreferrer",
          }, "notion.so/my-integrations"),
          " and copy the token.",
        ),
        h("li", null,
          h("strong", null, "Create or select a database"),
          " in your Notion workspace for storing PRD items.",
        ),
        h("li", null,
          h("strong", null, "Share the database"),
          " with your integration (click ••• in the database, then Connections).",
        ),
        h("li", null,
          h("strong", null, "Copy the database ID"),
          " from the URL and paste it above.",
        ),
        h("li", null,
          h("strong", null, "Test the connection"),
          " to verify everything works.",
        ),
      ),
      h("div", { class: "notion-config-security-note" },
        h("span", { class: "notion-config-security-icon" }, "\u{1F6E1}"),
        h("div", null,
          h("strong", null, "Security note: "),
          "Your API key is redacted on disk after saving. The actual token value is stored as an environment variable reference (",
          h("code", null, "REX_NOTION_TOKEN"),
          "). The key is never committed to version control.",
        ),
      ),
    ),
  );
}
