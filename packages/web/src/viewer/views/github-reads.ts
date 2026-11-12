/**
 * GitHub reads (`web.sidecarGithubReads`) on Settings › Project › Connections:
 * whether the Sidecar and branch health may ask `gh` without a card each time.
 *
 * Read and saved through GET/PUT /api/sidecar/settings, which writes the
 * untracked local config. Those routes answer only while the Sidecar is on,
 * so the form loads nothing until `active`.
 */

import { h } from "preact";
import { useCallback, useEffect, useState } from "preact/hooks";
import { SettingRow, Switch, type SettingRowSpec } from "./setting-row.js";
import type { ProjectSectionId } from "./project-sections.js";

const CONFIG_KEY = "web.sidecarGithubReads";

export interface GithubReadsForm {
  /** The saved value, or null before it loads (or while the Sidecar is off). */
  saved: boolean | null;
  /** The value shown: the edit, else the saved value. */
  value: boolean;
  loadError: string | null;
  saveError: string | null;
  dirty: boolean;
  set: (next: boolean) => void;
  /** PUT the edit. Resolves true once saved or when nothing changed. */
  save: () => Promise<boolean>;
  discard: () => void;
}

async function errorOf(res: Response, fallback: string): Promise<string> {
  const body = await res.json().catch(() => null) as { error?: string } | null;
  return body?.error ?? fallback;
}

export function useGithubReadsForm(active: boolean): GithubReadsForm {
  const [saved, setSaved] = useState<boolean | null>(null);
  const [edit, setEdit] = useState<boolean | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    // Off, the row is gone and its route refuses: an edit left behind could never save.
    if (!active) {
      setEdit(null);
      return;
    }
    let live = true;
    void (async () => {
      try {
        const res = await fetch("/api/sidecar/settings");
        if (!res.ok) throw new Error(await errorOf(res, "Failed to load GitHub reads"));
        const body = await res.json() as { githubReads?: boolean };
        if (live) {
          setSaved(body.githubReads === true);
          setLoadError(null);
        }
      } catch (err) {
        if (live) setLoadError(err instanceof Error ? err.message : "Failed to load GitHub reads");
      }
    })();
    return () => { live = false; };
  }, [active]);

  const dirty = edit !== null && edit !== saved;

  const save = useCallback(async (): Promise<boolean> => {
    if (!dirty) return true;
    setSaveError(null);
    try {
      const res = await fetch("/api/sidecar/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ githubReads: edit }),
      });
      if (!res.ok) {
        setSaveError(await errorOf(res, "Failed to save GitHub reads"));
        return false;
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save GitHub reads");
      return false;
    }
    setSaved(edit);
    setEdit(null);
    return true;
  }, [dirty, edit]);

  const discard = useCallback(() => {
    setEdit(null);
    setSaveError(null);
  }, []);

  const set = useCallback((next: boolean) => setEdit(next === saved ? null : next), [saved]);

  return { saved, value: edit ?? saved ?? false, loadError, saveError, dirty, set, save, discard };
}

const LABEL = "GitHub reads";
const DESCRIPTION = "Let the Sidecar and branch health read pull requests, issues and checks with gh, without asking each time.";

/** The GitHub reads row, once its value has loaded. */
export function githubReadsRows(form: GithubReadsForm): SettingRowSpec<ProjectSectionId>[] {
  if (form.saved === null) return [];
  return [{
    section: "connections",
    configKey: CONFIG_KEY,
    searchText: `${LABEL} ${DESCRIPTION} ${CONFIG_KEY}`,
    node: h(SettingRow, {
      key: CONFIG_KEY,
      configKey: CONFIG_KEY,
      label: LABEL,
      description: DESCRIPTION,
      info: h("p", null,
        "Reads run with your own gh login. Off, each read raises a card to approve, and branch health shows no GitHub facts. ",
        "Saved to your local config; the shared config's true applies only in a trusted checkout. It never allows a post.",
      ),
      unsaved: form.dirty,
      onReset: form.value ? () => form.set(false) : undefined,
      control: h(Switch, { checked: form.value, label: `Toggle ${LABEL}`, onChange: form.set }),
    }),
  }];
}
