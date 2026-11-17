/**
 * Sort state for a data table whose header cells sort it, by click or by
 * Enter/Space. The import-graph and merge-graph table views share it.
 *
 * @module web/viewer/views/column-sort
 */

import { useState } from "preact/hooks";

export interface ColumnSort<C extends string> {
  sortCol: C;
  sortAsc: boolean;
  /** The sorted column flips direction; any other column sorts ascending. */
  toggleSort: (col: C) => void;
  /** Keyboard activation for a header cell. */
  thKeyDown: (col: C) => (e: KeyboardEvent) => void;
  ariaSort: (col: C) => "ascending" | "descending" | "none";
  /** " ▲" / " ▼" after the sorted column's label; empty for the others. */
  sortArrow: (col: C) => string;
}

export function useColumnSort<C extends string>(initial: C): ColumnSort<C> {
  const [sortCol, setSortCol] = useState<C>(initial);
  const [sortAsc, setSortAsc] = useState(true);

  const toggleSort = (col: C) => {
    if (sortCol === col) setSortAsc((v) => !v);
    else { setSortCol(col); setSortAsc(true); }
  };

  return {
    sortCol,
    sortAsc,
    toggleSort,
    thKeyDown: (col) => (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleSort(col); }
    },
    ariaSort: (col) => (sortCol !== col ? "none" : sortAsc ? "ascending" : "descending"),
    sortArrow: (col) => (sortCol !== col ? "" : (sortAsc ? " ▲" : " ▼")),
  };
}
