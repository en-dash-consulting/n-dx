/**
 * `rex codeowners` — generate CODEOWNERS (GitHub) and `.bitbucket/CODEOWNERS`
 * (Bitbucket) from the product layer's stewards.
 *
 * Opt-in: nothing is read or written unless `.rex/config.json` sets
 * `"codeOwners": true`. The planning is pure (`../../codeowners/plan.ts`);
 * this command resolves the repository root, applies the plan and reports.
 * Files already holding the planned content are left untouched, so the command
 * is safe to run after every stewards edit.
 *
 * @module rex/cli/commands/codeowners
 */

import { mkdir, readFile, realpath } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { execStdout } from "@n-dx/llm-client";
import { planCodeOwners } from "../../codeowners/plan.js";
import { atomicWrite } from "../../store/atomic-write.js";
import { loadPrdModel, PRODUCT_DIRNAME } from "../../store/prd-model-reader.js";
import { resolveRexPaths, resolveStore } from "../../store/index.js";
import { CLIError, requireRexDir } from "../errors.js";
import { info, result, warn } from "../output.js";

const GIT_TIMEOUT_MS = 10_000;

async function repoRootOf(dir: string): Promise<string> {
  const top = (await execStdout("git", ["rev-parse", "--show-toplevel"], { cwd: dir, timeout: GIT_TIMEOUT_MS })).trim();
  if (!top) {
    throw new CLIError(
      dir + " is not inside a git repository.",
      "Code-owner files live at the repository root; run this inside a git checkout.",
    );
  }
  return realpath(top);
}

async function readIfExists(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export async function cmdCodeOwners(dir: string, flags: Record<string, string>): Promise<void> {
  requireRexDir(dir);
  const { rexDir } = resolveRexPaths(dir);

  const config = await (await resolveStore(rexDir)).loadConfig();
  if (config.codeOwners !== true) {
    info('Code-owner generation is off. Set "codeOwners": true in .rex/config.json to turn it on.');
    return;
  }

  const model = await loadPrdModel(rexDir);
  // An invalid header or area is skipped by the reader; its rules vanish, so say why.
  for (const w of model.warnings) warn(w.path + ": " + w.message);
  if (model.layout !== "v2") {
    throw new CLIError(
      "Stewards live in the v2 product layer, and this project is on the v1 tree.",
      "Migrate the PRD to the product layer first.",
    );
  }

  const root = await repoRootOf(dir);
  const productDir = relative(root, join(await realpath(rexDir), PRODUCT_DIRNAME)).split("\\").join("/");
  const plan = planCodeOwners({ defaultStewards: model.header?.stewards, product: model.tree.product, productDir });
  for (const message of plan.warnings) warn(message);

  const check = flags.check === "true";
  const stale: string[] = [];
  for (const file of plan.files) {
    const target = join(root, file.path);
    if ((await readIfExists(target)) === file.content) continue;
    stale.push(file.path);
    if (!check) {
      await mkdir(dirname(target), { recursive: true });
      await atomicWrite(target, file.content);
    }
  }

  if (check && stale.length) {
    throw new CLIError(
      "Out of date: " + stale.join(", "),
      "Run 'rex codeowners' to regenerate.",
    );
  }
  result(stale.length ? "Wrote " + stale.join(", ") : "Code-owner files are up to date.");
}
