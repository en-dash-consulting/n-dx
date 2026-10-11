/**
 * The product layer a v1 tree would get: rex's v1-to-v2 migration plan, drawn
 * in memory.
 *
 * `classifyV1Tree` is the plan's rules stage, pure and deterministic, with no
 * model pass: an epic becomes an area (unless its title names a PR or a
 * release), a feature with completed work a capability, a constraint-shaped
 * one a constraint, the work under them changes placed on them, and what the
 * rules cannot place is held in the Inbox. The template capability specs
 * (`draftCapabilitySpecs`, from the feature's own words and criteria) give
 * each capability its statement. A product node the plan marks met (its v1
 * item completed) is stamped `metAt` with its spec hash, as the apply will,
 * so rex's own status rule says met, changing or revised. Nothing is written:
 * the plan is a proposal for review, every product node the projection draws
 * from it says `proposed`, and the PRD's migration makes it real.
 */
import { classifyV1Tree, draftCapabilitySpecs, nodeSpec, specHash, type MigrationPlan, type PRDItem, type PrdModel, type RuleNode, type V2Tree } from "../rex-gateway.js";

export interface ProposedLayer {
  tree: V2Tree;
  plan: MigrationPlan;
}

const PRODUCT_TARGETS = new Set(["area", "capability", "constraint"]);

/** The tree the plan proposes for a v1 model, or undefined for a v2 one. */
export function proposeProductLayer(model: PrdModel): ProposedLayer | undefined {
  if (model.layout !== "v1") return undefined;
  // The v1 reader keeps every item field (level included) on its node, so the
  // tree reads back as the v1 items the plan classifies.
  const items = model.tree.changes as unknown as readonly PRDItem[];
  const plan = classifyV1Tree(items);
  const specs = new Map(draftCapabilitySpecs(plan, items, { testFiles: [] }).map((spec) => [spec.capability, spec]));
  const constraints = new Map(plan.constraints.map((c) => [c.source, c.appliesTo]));

  const source = new Map<string, RuleNode>();
  const index = (list: readonly RuleNode[]): void => {
    for (const node of list) {
      source.set(node.id, node);
      index(node.children ?? []);
    }
  };
  index(model.tree.changes);

  const nodes = new Map<string, RuleNode>();
  for (const entry of plan.entries) {
    if (entry.target === "release") continue; // dissolved into its changes' plannedRelease
    const from = source.get(entry.id);
    if (!from) continue;
    const { children: _children, ...fields } = from as RuleNode & Record<string, unknown>;
    const node: Record<string, unknown> = { ...fields, type: entry.target, children: [] };
    if (entry.target === "capability") {
      const spec = specs.get(entry.id);
      if (spec?.statement) node.statement = spec.statement;
      if (spec && spec.criteria.length > 0) node.criteria = spec.criteria.map(({ id, text }) => ({ id, text }));
    } else if (entry.target === "constraint") {
      const applies = constraints.get(entry.id);
      if (applies === "all") node.appliesTo = "all";
      else if (applies !== undefined) node.appliesTo = [applies];
      if (typeof fields.description === "string" && fields.description.trim() !== "") node.statement = fields.description.trim();
    }
    if (entry.met && (entry.target === "capability" || entry.target === "constraint")) {
      node.metAt = specHash(nodeSpec(node as unknown as RuleNode));
    }
    if (entry.target === "change") {
      if (entry.placement !== undefined && entry.relation === "amends") {
        node.amends = [{ target: entry.placement, delta: "modified", summary: entry.title }];
      } else if (entry.placement !== undefined) {
        node.touches = [entry.placement];
      }
      if (entry.needsPlacement) node.needsPlacement = true;
      if (entry.plannedRelease !== undefined) node.plannedRelease = entry.plannedRelease;
      if (entry.applied) {
        const at = typeof fields.completedAt === "string" ? fields.completedAt : typeof fields.lastModified === "string" ? fields.lastModified : undefined;
        if (at !== undefined) node.appliedAt = at;
      }
    }
    nodes.set(entry.id, node as unknown as RuleNode);
  }

  const tree: V2Tree = { product: [], changes: [] };
  for (const entry of plan.entries) {
    const node = nodes.get(entry.id);
    if (!node) continue;
    const parent = entry.parent !== undefined ? nodes.get(entry.parent) : undefined;
    if (parent) (parent.children ??= []).push(node);
    else if (PRODUCT_TARGETS.has(entry.target)) tree.product.push(node);
    else tree.changes.push(node);
  }
  return { tree, plan };
}
