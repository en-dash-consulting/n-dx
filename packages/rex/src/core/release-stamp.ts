/**
 * `rex release stamp <version>`: write `shippedIn` on the changes a release
 * ships, from git alone.
 *
 * A change ships in the release being stamped when it is live (not cancelled
 * or retired), finished (completed or applied), not yet stamped, landed on main,
 * and its landing commit is in no release tag yet. A change already stamped is
 * never restamped, so running the stamp again, with any version, changes
 * nothing. A change whose landing is already in an older tag stays unstamped:
 * `resolveShippedIn` reads its release from that tag. Under `rex.applyOn:
 * release` the stamp first applies every completed change still awaiting
 * apply, so each is then stamped like any other finished change.
 *
 * {@link planReleaseStamp} is pure: the landings and the released landing
 * commits come in as arguments. {@link gatherReleaseInputs} reads them from git
 * through `change-landing.ts`. The lock, the load and the write belong to the
 * caller.
 *
 * @module rex/core/release-stamp
 */

import { indexTree, type V2Tree } from "../schema/v2-rules.js";
import { applyOnTrigger, changesAwaitingApply, type ApplyOn } from "./apply-policy.js";
import type { ChangeCommitsOptions } from "./change-commits.js";
import { computeLandings, firstReleaseContaining, type ChangeLanding } from "./change-landing.js";

const RELEASE_VERSION = /^v?(\d+\.\d+\.\d+)$/;

/** `X.Y.Z` from `X.Y.Z` or `vX.Y.Z`; undefined for anything else, a prerelease suffix included. */
export function parseReleaseVersion(input: string): string | undefined {
  return RELEASE_VERSION.exec(input)?.[1];
}

export interface ReleaseStampInputs {
  /** The release, `X.Y.Z`. */
  version: string;
  applyOn: ApplyOn;
  /** Every live change's landing, by change id (`computeLandings`). */
  landings: Readonly<Record<string, ChangeLanding>>;
  /** Landing commits some release tag already contains. */
  released: ReadonlySet<string>;
  /** Stamped as `appliedAt` on a change applied under `applyOn: release`. */
  appliedAt: string;
  /** Date written on the History lines an apply adds. */
  now: Date;
}

export interface ReleaseStampReport {
  version: string;
  /** Changes applied under `applyOn: release`. */
  applied: string[];
  /** Changes given `shippedIn: version`. */
  stamped: string[];
  /** Finished changes left unstamped because they have not landed. */
  skipped: Array<{ id: string; reason: string }>;
}

export interface ReleaseStampPlan {
  /** The tree with the applies and stamps made; the input tree is not modified. */
  tree: V2Tree;
  report: ReleaseStampReport;
  /** Whether `tree` differs from the input. */
  changed: boolean;
}

/**
 * Apply (under `applyOn: release`) and stamp. A refused apply throws
 * `ApplyAmendmentsError`, naming the change, before anything is stamped.
 */
export function planReleaseStamp(input: V2Tree, inputs: ReleaseStampInputs): ReleaseStampPlan {
  let tree = structuredClone(input);
  const report: ReleaseStampReport = { version: inputs.version, applied: [], stamped: [], skipped: [] };

  if (inputs.applyOn === "release") {
    for (const { id } of changesAwaitingApply(tree)) {
      const outcome = applyOnTrigger(tree, id, "release", { applyOn: inputs.applyOn, appliedAt: inputs.appliedAt, now: inputs.now });
      if (!outcome.applied) throw new Error(`change ${id} awaits apply but was not applied: ${outcome.reason}`);
      tree = outcome.result.tree;
      report.applied.push(id);
    }
  }

  for (const { node, retired } of indexTree(tree, { includeTombstones: true }).entries) {
    if (node.type !== "change" || retired || node.status === "cancelled") continue;
    if (node.shippedIn || (node.status !== "completed" && node.appliedAt === undefined)) continue;
    const landing = inputs.landings[node.id];
    if (!landing?.landed) {
      report.skipped.push({ id: node.id, reason: landing?.reason ?? "no landing was computed for this change" });
      continue;
    }
    if (inputs.released.has(landing.commit)) continue;
    node.shippedIn = inputs.version;
    report.stamped.push(node.id);
  }

  return { tree, report, changed: report.applied.length + report.stamped.length > 0 };
}

/**
 * The git inputs for {@link planReleaseStamp}: every live change's landing,
 * and which of the landing commits that could be stamped a release tag already
 * contains. Reads git only when some change is finished.
 */
export async function gatherReleaseInputs(
  tree: V2Tree,
  options: ChangeCommitsOptions,
): Promise<Pick<ReleaseStampInputs, "landings" | "released">> {
  const landings = await computeLandings(tree, options);
  const unstamped = new Set(
    indexTree(tree).entries.filter(({ node }) => node.type === "change" && !node.shippedIn).map(({ node }) => node.id),
  );
  const candidates = new Set<string>();
  for (const [id, landing] of Object.entries(landings)) {
    if (landing.landed && unstamped.has(id)) candidates.add(landing.commit);
  }
  const released = new Set<string>();
  for (const commit of candidates) {
    if ((await firstReleaseContaining(options.repoDir, commit)) !== undefined) released.add(commit);
  }
  return { landings, released };
}
