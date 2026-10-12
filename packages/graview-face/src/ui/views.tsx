import { createViews } from "@graview/react";
import { registerDeclaredLenses, registerDefaultViews, registerViewSpecs } from "@graview/primitives";
import type { App } from "../app.js";

/**
 * Nothing custom, on purpose (bee-bot shipped none and the defaults carried
 * it): every kind at every fidelity from the declaration, the cards, rows and
 * pages the document writes as data, and every titled lens as a place.
 */
export function views(app: App) {
  const own = registerViewSpecs(registerDefaultViews(app.schema, createViews(app.schema)), app.schema, app.viewSpecs);
  return registerDeclaredLenses(own, app);
}
