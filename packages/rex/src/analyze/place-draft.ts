/**
 * Draft a placement for an existing open change with the configured `prd.place`
 * text model, without writing: the dashboard fills its placement form from the
 * draft and a person accepts it.
 *
 * Wires the project's LLM config and `rex.placement` settings to
 * {@link draftPlacement}, as `rex migrate-plan` wires them to the placement pass.
 *
 * @module rex/analyze/place-draft
 */

import { draftPlacement, type PlacementDraft } from "../core/change-place.js";
import { loadPlacementSettings } from "../core/placement-policy.js";
import type { V2Tree } from "../schema/v2-rules.js";
import { loadClaudeConfig, loadLLMConfig } from "../store/project-config.js";
import { setLLMConfig, setClaudeConfig, setProjectDir } from "./llm-bridge.js";
import { createTextPlacementModel } from "./place-reason.js";
import type { PlacementModel } from "../core/placement.js";

export interface DraftChangePlacementOptions {
  /** The project's `.rex` directory: settings and LLM config are read beside it. */
  rexDir: string;
  /** Directory the vendor CLI runs in. */
  projectDir: string;
  /** Pin a model; default is the `prd.place` route. */
  model?: string;
  /** Test seam: replaces the configured text model. */
  place?: PlacementModel;
}

export interface ChangePlacementDraft extends PlacementDraft {
  /** The model asked; absent when `rex.placement.models` turns the text model off. */
  model?: string;
}

/**
 * Draft a placement for `changeRef` in `tree`. When `rex.placement.models` is
 * `jev`, the text model is off and the draft is the rules shortlist with a
 * warning saying so. A model error propagates.
 */
export async function draftChangePlacement(
  tree: V2Tree,
  changeRef: string,
  options: DraftChangePlacementOptions,
): Promise<ChangePlacementDraft> {
  const { settings, warnings } = await loadPlacementSettings(options.rexDir);
  if (settings.models === "jev") {
    const rules = await draftPlacement(tree, changeRef);
    return { ...rules, warnings: [...warnings, 'rex.placement.models is "jev": the text model is off; showing the rules shortlist only'] };
  }
  let place = options.place;
  let model: string | undefined;
  if (!place) {
    setLLMConfig(await loadLLMConfig(options.rexDir));
    setClaudeConfig(await loadClaudeConfig(options.rexDir));
    setProjectDir(options.projectDir);
    ({ model, place } = createTextPlacementModel(options.model));
  }
  const draft = await draftPlacement(tree, changeRef, place);
  return { ...draft, ...(model ? { model } : {}), warnings: [...warnings, ...draft.warnings] };
}
