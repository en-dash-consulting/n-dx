/**
 * Writing a task's own saved `run` block — the one save path behind both
 * `PUT /api/hench/prep/:taskId` (the Prepare task modal's Save) and the
 * `saveRun` an execute request may carry (Start Working's one click on a task
 * with no saved settings, saved only once every execute gate has passed).
 *
 * Both writers get the same checks (rex's validator, the launch-only keys,
 * the active vendor's catalog and providers) and the same version semantics:
 * the caller sends the fingerprint of the block it read, and a write against a
 * read someone else has since overtaken is refused with a 409 carrying the
 * current block, rather than silently winning.
 *
 * @module web/server/task-run-settings
 */

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { resolveReviewModel } from "@n-dx/llm-client";
import type { ServerContext } from "./types.js";
import { readConfigSnapshot, resolveEffectiveAgentConfigFrom } from "./effective-agent-config.js";
import { resolveActiveVendor, validateCatalogModel } from "./routes-llm.js";
import { validateProviderForVendor } from "./hench-config-fields.js";
import { refreshPRDCache } from "./prd-io.js";
import { errorMessage } from "./response-utils.js";
import { findItem, resolveStore, updateInTree, validateRunSettings } from "./rex-gateway.js";
import type { RunSettings } from "./rex-gateway.js";
import { itemTypeOf } from "../shared/index.js";
import { isRunnableUnit } from "./runnable-units.js";
import type { WebSocketBroadcaster } from "./websocket.js";

/**
 * Launch-time options, which a task may never carry: they are chosen per launch
 * and saving one would make a decision on behalf of a future run that has not
 * been started yet. Named here rather than inferred from the absence of a rex
 * key so the 400 can say which key it refused and why.
 */
const LAUNCH_ONLY_KEYS: ReadonlySet<string> = new Set(["fresh", "allowDirty", "requireUnblocked", "resetDeferred"]);

/**
 * A short fingerprint of a task's saved block, used to detect a save racing
 * another writer.
 *
 * Canonical — keys sorted — so two blocks that differ only in key order share a
 * version and a save between them is not reported as a conflict. `"none"` for a
 * task carrying nothing, which is a real state the client can hold and send
 * back: it means "I believe this task has no saved settings".
 *
 * Deliberately not the item's `lastModified`: editing a task's title would then
 * invalidate a run-settings version the editor never touched, and every modal
 * left open would report a conflict that is not one.
 */
export function savedRunVersion(run: RunSettings | undefined | null): string {
  if (run === undefined || run === null || Object.keys(run).length === 0) return "none";
  return createHash("sha256").update(canonicalJson(run)).digest("hex").slice(0, 12);
}

/**
 * JSON with every object's keys sorted, at every depth.
 *
 * Written out rather than done with `JSON.stringify`'s array replacer, which
 * applies its whitelist at EVERY nesting level: `JSON.stringify({models:
 * {claude: "opus"}}, ["models"])` yields `{"models":{}}`, because `claude` is
 * not in the list. Every block with the same top-level keys then shared a
 * version, and two different model pins were indistinguishable — so a stale
 * save could overwrite another writer's pin with no 409, which is the single
 * thing this fingerprint exists to prevent.
 */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

/** The model each catalog-checked key would run for `vendor` with no task block and no flag. */
type ProjectDefaultModels = Partial<Record<"models" | "reviewModels", string>>;

/**
 * The agent and reviewer models `ndx work` runs for `vendor` when the task
 * carries nothing: the agent model through web's twin of hench's resolution
 * (`hench.models.<vendor>`, then `llm.*`), the reviewer through llm-client's
 * `resolveReviewModel`, which is the call hench makes. A config that fails to
 * resolve yields nothing, so every pin is checked against the catalog as usual.
 */
function projectDefaultModels(projectDir: string, vendor: string): ProjectDefaultModels {
  try {
    const { effective, llmConfig } = resolveEffectiveAgentConfigFrom(readConfigSnapshot(projectDir));
    if (effective.vendor !== vendor) return {};
    return {
      models: effective.model,
      reviewModels: resolveReviewModel(effective.vendor, llmConfig, undefined),
    };
  } catch {
    return {};
  }
}

/** How {@link checkSavedRun} treats the active vendor's model pins. */
export interface CheckSavedRunOptions {
  /**
   * Accept a pin equal to the model `ndx work` would run anyway without
   * asking the catalog. For an execute's `saveRun`: Start Working records the
   * project's own resolved model, which `ndx work` runs whether or not the
   * built-in list or the vendor's live listing (none for Google, none offline)
   * knows it, so a catalog miss there would block a start the terminal makes.
   * The modal's Save keeps the full check: it omits a field equal to its
   * default, so a pin it sends is a choice.
   */
  trustProjectDefaults?: boolean;
}

/** The request's `run` value, checked against both allow-lists, or the 400 to answer with. */
export async function checkSavedRun(
  projectDir: string,
  input: unknown,
  { trustProjectDefaults = false }: CheckSavedRunOptions = {},
): Promise<{ ok: true; run: RunSettings | undefined } | { ok: false; key?: string; error: string }> {
  if (input === undefined) return { ok: false, error: 'Body must carry "run" (an object, or null to clear)' };
  // `null` and `{}` both mean "no saved settings"; rex writes neither.
  if (input === null) return { ok: true, run: undefined };
  if (typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, key: "run", error: '"run" must be an object or null' };
  }
  const record = input as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (LAUNCH_ONLY_KEYS.has(key)) {
      return {
        ok: false,
        key,
        error: `Run setting "${key}" is chosen per launch and cannot be saved on a task`,
      };
    }
  }
  // rex owns the schema: known keys, their types and bounds, and which vendors a
  // `models` map may name. Unknown keys are refused here.
  const checked = validateRunSettings(record);
  if (!checked.ok) return { ok: false, error: checked.error };

  const value = checked.value;
  if (!value) return { ok: true, run: undefined };

  // The project's own checks on top of the shape. Only the entry for the ACTIVE
  // vendor is checked against the catalog: a saved block is deliberately
  // vendor-agnostic, so it may carry a pin for a vendor this project is not on
  // and whose catalog we cannot ask about. Refusing those would make the block
  // un-saveable from a project that merely happens to be on a different vendor
  // today — and `ndx work` already skips a pin its vendor cannot run, with a
  // warning naming the task.
  const vendor = resolveActiveVendor(projectDir);
  const defaults = trustProjectDefaults && vendor ? projectDefaultModels(projectDir, vendor) : {};
  for (const [key, models] of [
    ["models", value.models],
    ["reviewModels", value.reviewModels],
  ] as const) {
    const model = vendor ? (models as Record<string, string> | undefined)?.[vendor] : undefined;
    if (model === undefined) continue;
    if (defaults[key] !== undefined && model === defaults[key]) continue;
    const error = await validateCatalogModel(projectDir, vendor, model);
    if (error) return { ok: false, key, error: `Run setting "${key}.${vendor}": ${error}` };
  }
  if (value.provider !== undefined && vendor) {
    const error = validateProviderForVendor(value.provider, vendor);
    if (error) return { ok: false, key: "provider", error: `Run setting "provider": ${error}` };
  }
  return { ok: true, run: value };
}

/** A `{run, version}` pair, checked: the block to write and the version it was read at. */
export interface SaveRunRequest {
  /** `undefined` clears the block. */
  run: RunSettings | undefined;
  version: string;
}

/**
 * Check an execute request's `saveRun: {run, version}`: an object carrying a
 * non-null `run` block (an execute never clears settings) and the version the
 * caller read, with the block held to the same checks a PUT applies.
 */
export async function checkSaveRunRequest(
  projectDir: string,
  input: unknown,
): Promise<{ ok: true; request: SaveRunRequest } | { ok: false; key?: string; error: string }> {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, key: "saveRun", error: '"saveRun" must be an object: {run, version}' };
  }
  const record = input as Record<string, unknown>;
  const version = record["version"];
  if (typeof version !== "string" || version.length === 0) {
    return { ok: false, key: "saveRun.version", error: '"saveRun" must carry "version" (the version a GET reported)' };
  }
  if (record["run"] === null || typeof record["run"] !== "object" || Array.isArray(record["run"])) {
    return { ok: false, key: "saveRun.run", error: '"saveRun.run" must be an object' };
  }
  const checked = await checkSavedRun(projectDir, record["run"], { trustProjectDefaults: true });
  // Keys are named under `saveRun.run` so a caller can tell "the settings to
  // save were refused" from a refusal of the start itself.
  if (!checked.ok) {
    const key = checked.key && checked.key !== "run" ? `saveRun.run.${checked.key}` : "saveRun.run";
    return { ok: false, key, error: checked.error };
  }
  return { ok: true, request: { run: checked.run, version } };
}

/** The 409 body a version conflict answers with: the current block and its version. */
export function runConflictBody(saved: RunSettings | null, version: string): Record<string, unknown> {
  // The current values travel with the refusal so the client can show what it
  // would overwrite and offer to do so — resending with this version is the
  // overwrite.
  return {
    error: "These run settings were changed by someone else since you loaded them",
    conflict: true,
    saved,
    version,
  };
}

/** What {@link writeTaskRun} came to: the stored block and its version, or the answer to give. */
export type TaskRunWrite =
  | { ok: true; saved: RunSettings | null; version: string }
  | { ok: false; status: number; body: Record<string, unknown> };

/**
 * Write (or, with `run: undefined`, clear) a task's saved block, if the block
 * on disk is still the one `version` names.
 *
 * Read, check and write happen inside one PRD transaction: the version check
 * is only worth having if nothing can land between the read it compares
 * against and the write it guards. `run` must already have passed
 * {@link checkSavedRun}.
 */
export async function writeTaskRun(
  ctx: ServerContext,
  taskId: string,
  { run, version }: SaveRunRequest,
  broadcast?: WebSocketBroadcaster,
): Promise<TaskRunWrite> {
  // A workspace with no `.rex/` has no PRD to write to. Without this the store
  // fails trying to create its lock file and the route answers 500, where the
  // honest answer is the same 404 the ready list gives.
  if (!existsSync(ctx.rexDir)) return { ok: false, status: 404, body: { error: "No PRD data found" } };

  let conflict: { saved: RunSettings | null; version: string } | null = null;
  let missing = false;
  let notRunnable: string | null = null;
  let updatedDoc;
  try {
    const store = await resolveStore(ctx.rexDir);
    updatedDoc = await store.withTransaction(async (doc) => {
      const entry = findItem(doc.items, taskId);
      if (!entry) {
        missing = true;
        return doc;
      }
      if (!isRunnableUnit(entry.item)) {
        notRunnable = itemTypeOf(entry.item) === "change"
          ? `Change "${taskId}" does not run as one task; n-dx work runs its tasks, so save run settings on those tasks`
          : `Item "${taskId}" is not a task or subtask, so it cannot carry run settings`;
        return doc;
      }
      const current = entry.item.run as RunSettings | undefined;
      const currentVersion = savedRunVersion(current);
      if (currentVersion !== version) {
        conflict = { saved: current ?? null, version: currentVersion };
        return doc;
      }
      // `undefined` removes the block: the serializer skips an absent `run`.
      updateInTree(doc.items, taskId, { run } as never);
      return doc;
    });
  } catch (err) {
    const message = errorMessage(err);
    // The lock failure names the holder's PID, which is the most useful fact in
    // it — passed through rather than replaced with wording of our own.
    return { ok: false, status: message.includes("Could not acquire PRD lock") ? 409 : 500, body: { error: message } };
  }

  if (missing) return { ok: false, status: 404, body: { error: `Task "${taskId}" not found` } };
  if (notRunnable) {
    return {
      ok: false,
      status: 400,
      body: { error: notRunnable },
    };
  }
  if (conflict) {
    const current = conflict as { saved: RunSettings | null; version: string };
    return { ok: false, status: 409, body: runConflictBody(current.saved, current.version) };
  }

  // The watcher will catch up on its own; refreshing here makes the change
  // visible to the next read in this process rather than one tick later.
  refreshPRDCache(ctx.rexDir, updatedDoc);
  if (broadcast) {
    broadcast({
      type: "rex:item-updated",
      itemId: taskId,
      updates: { run: run ?? null },
      timestamp: new Date().toISOString(),
    });
  }
  return { ok: true, saved: run ?? null, version: savedRunVersion(run) };
}
