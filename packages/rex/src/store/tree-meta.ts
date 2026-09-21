/**
 * `tree-meta.json` — the sidecar holding what the folder tree itself cannot.
 *
 * The tree is a directory of item files. Two document-level facts have nowhere
 * to live in it, so they live here:
 *
 * - **title**, which belongs to the document rather than to any item.
 * - **schema**, the version the tree was written at.
 * - **slugRule**, the version of the path rule the tree was written under.
 *
 * The schema marker exists because omitting it defeated forward compatibility
 * at one remove. The tree load path used to report the *running*
 * `SCHEMA_VERSION` regardless of what wrote the tree, and the document schema
 * is a `.passthrough()` while `isCompatibleSchema` admits newer minors — so a
 * tree written by a future `rex/v1.1` loads here intact, unrecognised fields
 * included, while claiming to be `rex/v1`. Exporting it produced a bundle
 * labelled `rex/v1`, and `parseBundle`'s minor gate then compared equal minors
 * and let those fields into another tree unvalidated. A version gate can only
 * refuse what the document was honest about.
 *
 * Four call sites write this file, through three different mechanisms
 * (`writeFile`, `atomicWrite`, `atomicWriteJSON`), because they differ in their
 * durability needs. The *shape* is built here so those four cannot drift apart
 * — which is how the schema field would quietly go missing from one writer.
 *
 * @module store/tree-meta
 */

import { SCHEMA_VERSION } from "../schema/index.js";
import { SLUG_RULE_VERSION } from "./folder-tree-serializer.js";

/** The document-level facts the tree cannot hold on its own. */
export interface TreeMeta {
  title: string;
  schema: string;
  /**
   * Version of the slug rule that produced the paths in this tree.
   *
   * Unlike `schema`, this is never carried on the in-memory document: it
   * describes the *writing build*, not the document, and the build is always
   * this one. A tree whose marker disagrees with `SLUG_RULE_VERSION` is a tree
   * this build must not write — see `assertSlugRuleWritable`.
   *
   * Deliberately a named field rather than a positional or derived one: the
   * 1.0.0 storage change folds this whole sidecar into the root `index.md`
   * frontmatter, and a named field moves there as-is. Anything that inferred
   * the rule from the file's shape would have to be rewritten instead.
   */
  slugRule: number;
}

/**
 * Build the contents of `tree-meta.json` for a document.
 *
 * `schema` falls back to the running version for a document assembled in
 * memory without one — a bundle import or a legacy migration, neither of which
 * has a tree to have read it from.
 *
 * `slugRule` is unconditionally the running version, because the serializer
 * about to run *is* the running version — there is no way to write a tree
 * under any other rule. What stops that from quietly re-slugging someone
 * else's tree is the guard in the save path, which refuses before this file is
 * written; by the time the shape is built, the write has already been allowed.
 */
export function treeMetaContents(doc: { title: string; schema?: string }): TreeMeta {
  return {
    title: doc.title,
    schema: doc.schema ?? SCHEMA_VERSION,
    slugRule: SLUG_RULE_VERSION,
  };
}

/**
 * Read back whichever fields the file actually carries.
 *
 * Both are optional on the way in, and for different reasons. `title` has
 * always been optional here. `schema` is absent from every tree written before
 * the marker existed, which must keep loading rather than being treated as
 * corrupt — so an absent or non-string marker is not an error, it is a tree
 * that predates the field, and the caller supplies the running version.
 *
 * A marker that *is* a string is returned verbatim, including one this rex
 * cannot read. That is the whole point: the compatibility checks downstream
 * are what should refuse `rex/v2`, and they can only do so if the value
 * reaches them. Swallowing it here would rebuild the hole the marker closes.
 *
 * @param raw Raw file contents. Malformed JSON yields an empty result rather
 *   than throwing, matching how the title has always been read.
 */
export function parseTreeMeta(raw: string): Partial<TreeMeta> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object") return {};

  const meta = parsed as Record<string, unknown>;
  const out: Partial<TreeMeta> = {};
  if (typeof meta["title"] === "string") out.title = meta["title"];
  if (typeof meta["schema"] === "string") out.schema = meta["schema"];
  // Absent on every tree written before the guard, which is the case the guard
  // is built to handle rather than an error. A non-integer is treated the same
  // as absent: the marker is only ever written from `SLUG_RULE_VERSION`, so a
  // string or a float is corruption, and the conformance fallback checks the
  // paths themselves — a stricter answer than trusting a damaged number.
  if (typeof meta["slugRule"] === "number" && Number.isInteger(meta["slugRule"])) {
    out.slugRule = meta["slugRule"];
  }
  return out;
}
