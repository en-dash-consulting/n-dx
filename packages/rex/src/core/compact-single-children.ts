/**
 * Single-child compaction: deprecated and removed.
 *
 * The previous schema used `__parent*` shims to elide parent folders when an
 * item had exactly one child. The current schema (see
 * `docs/architecture/prd-folder-tree-schema.md`) stores every PRD item in
 * its own folder containing `index.md`. There is no longer any disk-side
 * "compaction" step.
 *
 * Existing trees that still contain `__parent*` shims are normalized
 * implicitly by the parser+serializer round-trip: the parser reconstructs
 * the missing parent in memory, and the next save writes every item back
 * to its own folder while the serializer's `removeStaleEntries` sweeps up
 * the elided child file.
 *
 * Callers should drive that round-trip via:
 * `store.saveDocument(await store.loadDocument())`
 * to canonicalize the on-disk tree.
 *
 * @module core/compact-single-children
 */

// This file is now empty but retained to avoid breaking old imports.
// See module documentation for the canonical canonicalization workflow.
