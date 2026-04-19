/**
 * Notion Configuration view — manages Notion API credentials and connection.
 *
 * Provides a secure form for entering Notion API key and database ID,
 * validates input format, tests the connection, and displays connection
 * health status with a green/yellow/red indicator.
 *
 * Data comes from:
 *   GET    /api/notion/config  — current config (masked token)
 *   PUT    /api/notion/config  — save credentials
 *   POST   /api/notion/test    — test connection
 *   DELETE /api/notion/config  — remove config
 */

import { h, Fragment } from "preact";
import { useState, useEffect, useCallback, useRef } from "preact/hooks";
import { BrandedHeader } from "../components/index.js";
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
        class: "cmd-sync-btn",
        onClick: () => handleSync("push"),
        disabled: syncState === "running",
      },
        syncState === "running" ? h("span", { class: "cmd-inline-spinner", "aria-hidden": "true" }) : "\u2191",
        " Push",
      ),
      h("button", {
        class: "cmd-sync-btn",
        onClick: () => handleSync("pull"),
        disabled: syncState === "running",
      },
        syncState === "running" ? h("span", { class: "cmd-inline-spinner", "aria-hidden": "true" }) : "\u2193",
        " Pull",
      ),
      h("button", {
        class: "cmd-sync-btn",
        onClick: () => handleSync("sync"),
        disabled: syncState === "running",
      },
        syncState === "running" ? h("span", { class: "cmd-inline-spinner", "aria-hidden": "true" }) : "\u21C5",
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

// ── Main view ────────────────────────────────────────────────────────

export function NotionConfigView() {
  const [loading, setLoading] = useState(true);
  const [config, setConfig] = useState<NotionConfig | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [token, setToken] = useState("");
  const [databaseId, setDatabaseId] = useState("");
  const [tokenVisible, setTokenVisible] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<ValidationErrors>({});

  // Save state
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Connection test state
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);

  // Remove state
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);

  // ── Fetch current config ────────────────────────────────────────────

  const fetchConfig = useCallback(async () => {
    try {
      const res = await fetch("/api/notion/config");
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Failed to load" }));
        setError((body as { error?: string }).error ?? "Failed to load configuration");
        return;
      }
      const data = await res.json() as NotionConfig;
      setConfig(data);
      setError(null);

      // Populate form with existing values
      if (data.configured) {
        setDatabaseId(data.databaseId ?? "");
        // Token is never returned in plain text; form stays empty
        setToken("");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load configuration");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConfig();
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [fetchConfig]);

  // ── Validate on change ──────────────────────────────────────────────

  const handleTokenChange = useCallback((e: Event) => {
    const value = (e.target as HTMLInputElement).value;
    setToken(value);
    if (value.trim().length > 0) {
      const err = validateApiKeyFormat(value);
      setFieldErrors((prev) => ({ ...prev, token: err ?? undefined }));
    } else {
      setFieldErrors((prev) => ({ ...prev, token: undefined }));
    }
  }, []);

  const handleDatabaseIdChange = useCallback((e: Event) => {
    const value = (e.target as HTMLInputElement).value;
    setDatabaseId(value);
    if (value.trim().length > 0) {
      const err = validateDatabaseIdFormat(value);
      setFieldErrors((prev) => ({ ...prev, databaseId: err ?? undefined }));
    } else {
      setFieldErrors((prev) => ({ ...prev, databaseId: undefined }));
    }
  }, []);

  // ── Save handler ────────────────────────────────────────────────────

  const handleSave = useCallback(async () => {
    // Build payload — only include fields that have values
    const payload: Record<string, string> = {};

    if (token.trim().length > 0) {
      const tokenErr = validateApiKeyFormat(token);
      if (tokenErr) {
        setFieldErrors((prev) => ({ ...prev, token: tokenErr }));
        return;
      }
      payload.token = token.trim();
    }

    if (databaseId.trim().length > 0) {
      const dbErr = validateDatabaseIdFormat(databaseId);
      if (dbErr) {
        setFieldErrors((prev) => ({ ...prev, databaseId: dbErr }));
        return;
      }
      payload.databaseId = databaseId.trim();
    }

    if (Object.keys(payload).length === 0) {
      setError("Enter at least one field to save");
      return;
    }

    setSaving(true);
    setError(null);
    setSaveSuccess(false);

    try {
      const res = await fetch("/api/notion/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Save failed" }));
        if ((body as { errors?: Record<string, string> }).errors) {
          setFieldErrors((body as { errors: Record<string, string> }).errors as ValidationErrors);
        } else {
          setError((body as { error?: string }).error ?? "Save failed");
        }
        return;
      }

      setSaveSuccess(true);
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => setSaveSuccess(false), 3000);

      // Clear token field after save (it's now redacted on disk)
      setToken("");
      setTokenVisible(false);

      // Refresh config display
      await fetchConfig();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }, [token, databaseId, fetchConfig]);

  // ── Test connection handler ─────────────────────────────────────────

  const handleTest = useCallback(async () => {
    setTesting(true);
    setTestResult(null);

    try {
      // Send current form values for testing
      const payload: Record<string, string> = {};
      if (token.trim().length > 0) payload.token = token.trim();
      if (databaseId.trim().length > 0) payload.databaseId = databaseId.trim();

      const res = await fetch("/api/notion/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        setTestResult({
          status: "red",
          message: "Connection test request failed",
        });
        return;
      }

      const result = await res.json() as ConnectionTestResult;
      setTestResult(result);
    } catch (err) {
      setTestResult({
        status: "red",
        message: err instanceof Error ? err.message : "Connection test failed",
      });
    } finally {
      setTesting(false);
    }
  }, [token, databaseId]);

  // ── Remove handler ──────────────────────────────────────────────────

  const handleRemove = useCallback(async () => {
    setRemoving(true);
    try {
      const res = await fetch("/api/notion/config", { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Remove failed" }));
        setError((body as { error?: string }).error ?? "Remove failed");
        return;
      }

      // Reset all state
      setToken("");
      setDatabaseId("");
      setTestResult(null);
      setConfirmRemove(false);
      await fetchConfig();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Remove failed");
    } finally {
      setRemoving(false);
    }
  }, [fetchConfig]);

  // ── Render ──────────────────────────────────────────────────────────

  if (loading) {
    return h("div", { class: "notion-config-container" },
      h("div", { class: "loading" }, "Loading Notion configuration..."),
    );
  }

  if (error && !config) {
    return h("div", { class: "notion-config-container" },
      h(BrandedHeader, { product: "rex", title: "Notion Integration" }),
      h("div", { class: "notion-config-error-state" },
        h("p", null, error),
        h("p", { class: "notion-config-error-hint" },
          "Make sure ",
          h("code", null, ".rex/"),
          " exists. Run ",
          h("code", null, "rex init"),
          " to create it.",
        ),
      ),
    );
  }

  const isConfigured = config?.configured ?? false;

  return h("div", { class: "notion-config-container" },
    // ── Header ──────────────────────────────────────────────────────────
    h("div", { class: "notion-config-header" },
      h(BrandedHeader, { product: "rex", title: "Notion Integration" }),
      h("p", { class: "notion-config-subtitle" },
        "Connect your PRD to a Notion database for two-way sync.",
      ),
    ),

    // ── Connection status ───────────────────────────────────────────────
    h("div", { class: "notion-config-section" },
      h("h3", { class: "notion-config-section-title" },
        h("span", { class: "notion-config-section-icon" }, "\u{1F50C}"),
        "Connection Status",
      ),
      h(ConnectionStatus, { result: testResult, testing }),
      isConfigured
        ? h(EnvVarHint, { envVar: config?.tokenEnvVar ?? null })
        : null,
    ),

    // ── Error banner ────────────────────────────────────────────────────
    error
      ? h("div", { class: "notion-config-error-banner" }, error)
      : null,

    // ── Save success toast ──────────────────────────────────────────────
    saveSuccess
      ? h("div", { class: "notion-config-toast" },
          h("span", { class: "notion-config-toast-icon" }, "\u2714"),
          "Configuration saved",
        )
      : null,

    // ── Form ────────────────────────────────────────────────────────────
    h("div", { class: "notion-config-section" },
      h("h3", { class: "notion-config-section-title" },
        h("span", { class: "notion-config-section-icon" }, "\u{1F511}"),
        "Credentials",
      ),

      // API Key field
      h("div", { class: `notion-config-field${fieldErrors.token ? " notion-config-field-error" : ""}` },
        h("label", { class: "notion-config-label" },
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
            type: tokenVisible ? "text" : "password",
            class: "notion-config-input",
            value: token,
            placeholder: isConfigured
              ? `Current: ${config?.tokenMasked ?? "****"}`
              : "secret_xxxxx or ntn_xxxxx",
            onInput: handleTokenChange,
            autocomplete: "off",
            spellcheck: false,
          }),
          h("button", {
            type: "button",
            class: "notion-config-toggle-visibility",
            onClick: () => setTokenVisible(!tokenVisible),
            title: tokenVisible ? "Hide token" : "Show token",
            "aria-label": tokenVisible ? "Hide token" : "Show token",
          }, tokenVisible ? "\u{1F441}" : "\u{1F441}\u200D\u{1F5E8}"),
        ),
        fieldErrors.token
          ? h("div", { class: "notion-config-field-error-text" }, fieldErrors.token)
          : null,
      ),

      // Database ID field
      h("div", { class: `notion-config-field${fieldErrors.databaseId ? " notion-config-field-error" : ""}` },
        h("label", { class: "notion-config-label" },
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
          type: "text",
          class: "notion-config-input",
          value: databaseId,
          placeholder: "e.g. a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
          onInput: handleDatabaseIdChange,
          autocomplete: "off",
          spellcheck: false,
        }),
        fieldErrors.databaseId
          ? h("div", { class: "notion-config-field-error-text" }, fieldErrors.databaseId)
          : null,
      ),
    ),

    // ── Actions ─────────────────────────────────────────────────────────
    h("div", { class: "notion-config-actions" },
      h("div", { class: "notion-config-actions-primary" },
        h("button", {
          type: "button",
          class: "notion-config-save-btn",
          onClick: handleSave,
          disabled: saving || (token.trim().length === 0 && databaseId.trim().length === 0),
        }, saving ? "Saving..." : "Save Configuration"),
        h("button", {
          type: "button",
          class: "notion-config-test-btn",
          onClick: handleTest,
          disabled: testing,
        }, testing ? "Testing..." : "Test Connection"),
      ),
      isConfigured
        ? h("div", { class: "notion-config-actions-danger" },
            confirmRemove
              ? h(Fragment, null,
                  h("span", { class: "notion-config-confirm-text" }, "Remove Notion config?"),
                  h("button", {
                    type: "button",
                    class: "notion-config-confirm-yes",
                    onClick: handleRemove,
                    disabled: removing,
                  }, removing ? "Removing..." : "Yes, Remove"),
                  h("button", {
                    type: "button",
                    class: "notion-config-confirm-no",
                    onClick: () => setConfirmRemove(false),
                  }, "Cancel"),
                )
              : h("button", {
                  type: "button",
                  class: "notion-config-remove-btn",
                  onClick: () => setConfirmRemove(true),
                }, "Remove Configuration"),
          )
        : null,
    ),

    // ── Schema validation wizard ──────────────────────────────────────
    h("div", { class: "notion-config-section" },
      h(NotionSchemaWizard, { isConfigured }),
    ),

    // ── Sync panel (only when configured) ────────────────────────────
    isConfigured
      ? h(SyncPanel, null)
      : null,

    // ── Help section ────────────────────────────────────────────────────
    h("div", { class: "notion-config-section notion-config-help" },
      h("h3", { class: "notion-config-section-title" },
        h("span", { class: "notion-config-section-icon" }, "\u2139"),
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
          " with your integration (click \u2022\u2022\u2022 in the database, then Connections).",
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
