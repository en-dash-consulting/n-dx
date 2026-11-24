/**
 * What narrows the Plan page, shared by its parts: whose work it shows (For me
 * or Everyone), which stage How work moves focuses on (the Inbox or a placed
 * change's stage), and whether the project is worked
 * Solo or as a Team. The product areas, the Inbox side panel and the head's
 * controls each read and set it, so one module-level store keeps them in step.
 *
 * Scope and mode are remembered in the browser (`ndx.plan-view`); the stage
 * focus is not, so the page opens unfiltered by stage. Storage failures are
 * ignored: the choice then lasts for the page.
 *
 * @module viewer/views/plan-view-state
 */

import { useEffect, useState } from "preact/hooks";
import type { OpenChangeStage } from "./product-model.js";

export type PlanScope = "me" | "all";
export type PlanMode = "team" | "solo";
/** A stage How work moves can focus: the Inbox, then the stages of a placed open change. */
export type PlanStage = "inbox" | OpenChangeStage;

export interface PlanViewState {
  scope: PlanScope;
  stage: PlanStage | null;
  mode: PlanMode;
}

const KEY = "ndx.plan-view";
const DEFAULTS: PlanViewState = { scope: "all", stage: null, mode: "team" };

function readStored(): Pick<PlanViewState, "scope" | "mode"> {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<PlanViewState>;
    return {
      scope: raw.scope === "me" ? "me" : "all",
      mode: raw.mode === "solo" ? "solo" : "team",
    };
  } catch {
    return { scope: DEFAULTS.scope, mode: DEFAULTS.mode };
  }
}

let state: PlanViewState | null = null;
const listeners = new Set<(s: PlanViewState) => void>();

function current(): PlanViewState {
  state ??= { ...DEFAULTS, ...readStored() };
  return state;
}

/** Change part of the view; every subscriber re-renders. */
export function setPlanView(patch: Partial<PlanViewState>): void {
  state = { ...current(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify({ scope: state.scope, mode: state.mode }));
  } catch { /* storage unavailable — the choice lasts for this page */ }
  for (const listener of listeners) listener(state);
}

/** The shared view, re-rendering when any part of the page changes it. */
export function usePlanView(): PlanViewState {
  const [view, setView] = useState<PlanViewState>(current);
  useEffect(() => {
    listeners.add(setView);
    setView(current());
    return () => { listeners.delete(setView); };
  }, []);
  return view;
}

/** Forget the in-memory state so the next read starts from storage. Tests only. */
export function _resetPlanViewForTests(): void {
  state = null;
}
