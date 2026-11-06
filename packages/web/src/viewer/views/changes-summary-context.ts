/**
 * One read of `GET /api/rex/changes/summary` for the whole Plan stage grid.
 *
 * `useProductRead` neither dedupes nor caches, so each panel that called it
 * paid for a full model load on every Plan load and every PRD write. The
 * provider reads once; the lifecycle strip and the open-changes glance consume
 * the result.
 *
 * @module viewer/views/changes-summary-context
 */

import { createContext, h } from "preact";
import type { ComponentChildren } from "preact";
import { useContext } from "preact/hooks";
import { useProductRead, type Load } from "../hooks/index.js";
import type { ChangeSummary } from "./product-model.js";

const ChangesSummaryContext = createContext<Load<ChangeSummary> | null>(null);

/** Reads the summary once and shares it with every panel beneath. */
export function ChangesSummaryProvider({ children }: { children?: ComponentChildren }) {
  const load = useProductRead("/api/rex/changes/summary", (body) => body.summary as ChangeSummary);
  return h(ChangesSummaryContext.Provider, { value: load }, children);
}

/** The shared summary read; a panel outside a provider is a wiring bug. */
export function useChangesSummary(): Load<ChangeSummary> {
  const load = useContext(ChangesSummaryContext);
  if (!load) throw new Error("useChangesSummary needs a ChangesSummaryProvider above it");
  return load;
}
