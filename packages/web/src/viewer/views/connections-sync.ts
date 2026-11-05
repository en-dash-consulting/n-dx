/**
 * Tracker sync rules in Settings > Project > Connections: one switch per ndx
 * event (off, dry-run, on) and a button that puts every active rule on
 * dry-run. Each change is saved at once to `trackerSync.rules` in the
 * untracked local config file; every rule is off until set. Dry-run records
 * the call the rule would make and sends nothing.
 */

import { h } from "preact";
import { useCallback, useEffect, useState } from "preact/hooks";
import { errorText, readError, send, type ReportNotice } from "./connections-api.js";

export const RULE_MODES = ["off", "dry-run", "on"] as const;
export type RuleMode = (typeof RULE_MODES)[number];

interface SyncSettings {
  connection: string | null;
  rules: Record<string, RuleMode>;
  events: string[];
  connections: string[];
  problems?: string[];
}

const EVENT_LABELS: Record<string, string> = {
  "change-captured": "A change is captured",
  "run-started": "A run starts",
  "pr-opened": "A pull request opens",
  "pr-merged": "A pull request merges",
  "release-published": "A release is published",
  "run-failed-twice": "A run fails twice",
};

const eventLabel = (event: string): string => EVENT_LABELS[event] ?? event;

export interface SyncRulesProps {
  /** The declared connections' ids; the rules reload when they change. */
  connectionIds: readonly string[];
  onNotice: ReportNotice;
}

export function SyncRulesSection({ connectionIds, onNotice }: SyncRulesProps) {
  const [settings, setSettings] = useState<SyncSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const idsKey = connectionIds.join(",");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/connections/sync");
      if (!res.ok) {
        setLoadError(await readError(res));
        return;
      }
      setSettings((await res.json()) as SyncSettings);
      setLoadError(null);
    } catch (err) {
      setLoadError(errorText(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, idsKey]);

  const save = async (rules: Record<string, RuleMode>, connection?: string) => {
    setBusy(true);
    onNotice(null);
    try {
      const target = connection ?? settings?.connection ?? (chosen || connectionIds[0]);
      const res = await send("PUT", "/api/connections/sync", { rules, ...(target ? { connection: target } : {}) });
      if (!res.ok) {
        onNotice({ kind: "error", text: `Could not save the sync rules: ${await readError(res)}` });
        return;
      }
      setSettings((await res.json()) as SyncSettings);
    } catch (err) {
      onNotice({ kind: "error", text: `Could not save the sync rules: ${errorText(err)}` });
    } finally {
      setBusy(false);
    }
  };

  if (connectionIds.length === 0) return null;
  if (loadError) return h("p", { class: "connections-notice connections-notice--error", role: "alert" }, `Could not read the sync rules: ${loadError}`);
  if (!settings) return h("p", { class: "connections-empty", role: "status" }, "Loading sync rules…");

  const active = Object.entries(settings.rules).filter(([, mode]) => mode === "on").map(([event]) => event);
  const via = settings.connection ?? (chosen || connectionIds[0]);

  return h("div", { class: "connections-sync", id: "tracker-sync" },
    h("h3", { class: "connections-subtitle" }, "Tracker sync"),
    h("p", { class: "project-section-note" },
      "Rules turn project events into calls on a connection. Every rule is off until you turn it on; a dry-run rule records the call it would make and sends nothing.",
    ),
    settings.problems
      ? h("p", { class: "connections-notice connections-notice--error", role: "alert" }, `The trackerSync block cannot be used: ${settings.problems.join("; ")}`)
      : null,
    h("div", { class: "connections-field-row" },
      h("label", { class: "connections-field-label", for: "connection-sync-via" }, "Calls go through"),
      h("select", {
        id: "connection-sync-via",
        class: "connections-select",
        value: via,
        disabled: busy,
        onChange: (event: Event) => {
          const value = (event.target as HTMLSelectElement).value;
          setChosen(value);
          // Already configured: moving it is a save. Otherwise it waits for the first rule.
          if (settings.connection !== null) void save({}, value);
        },
      }, connectionIds.map((id) => h("option", { key: id, value: id }, id))),
    ),
    h("ul", { class: "connections-rules" },
      settings.events.map((event) =>
        h("li", { key: event, class: "connections-rule", "data-event": event },
          h("label", { class: "connections-rule-label", for: `connection-rule-${event}` }, eventLabel(event)),
          h("select", {
            id: `connection-rule-${event}`,
            class: "connections-select",
            value: settings.rules[event] ?? "off",
            disabled: busy,
            onChange: (e: Event) => void save({ [event]: (e.target as HTMLSelectElement).value as RuleMode }),
          }, RULE_MODES.map((mode) => h("option", { key: mode, value: mode }, mode))),
        ),
      ),
    ),
    h("div", { class: "connections-actions" },
      h("button", {
        type: "button",
        class: "connections-button",
        disabled: busy || active.length === 0,
        title: active.length === 0 ? "No rule is on." : "Put every rule that is on back to dry-run.",
        onClick: () => void save(Object.fromEntries(active.map((event) => [event, "dry-run" as RuleMode]))),
      }, "Switch all to dry-run"),
    ),
  );
}
