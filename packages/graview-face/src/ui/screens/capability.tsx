import { recordFacts, recordPath, useStoreTick } from "@graview/pages";
import { Link, useParams } from "react-router-dom";
import type { App } from "../../app.js";
import { computedValues } from "@graview/core/blocks";
import { edgesOf, inward, label, nodeOf, said, toneOfStatus } from "../../model/graph.js";
import { DeclaredBlocks, declaredPage, opening } from "../declared.js";
import { Badge, Empty, Facts, Hero, KindIcon, Page, RecordRow, Rows, Section, Stat, Stats, type Ctx } from "../kit.js";
import { Missing, Problems, Under } from "./generic.js";

/**
 * A CAPABILITY'S PAGE: what the product promises, whether it is met, who is
 * changing it, and where in the code its commits landed. The declared page
 * (n-dx.graview.json, views.capability.page) supplies the lists; this screen
 * frames them with the standing, the criteria and the constraints.
 */
export function CapabilityScreen({ context, app }: { context: Ctx; app: App }) {
  const { store, principal, invariantContext } = context;
  useStoreTick(store);
  const id = decodeURIComponent(useParams()["id"] ?? "");
  const node = nodeOf(store, id, "capability");
  const facts = recordFacts(store, id, { ...(principal ? { principal } : {}), ...(invariantContext ? { context: invariantContext } : {}) });
  if (!node || !facts) return <Missing context={context} />;

  const page = opening(declaredPage(context, app, node));
  const depends = edgesOf(store, node, "dependsOn");
  const neededBy = inward(store, id, "dependsOn");
  const bound = inward(store, id, "appliesTo");
  const standing = node.intentStatus ?? "proposed";
  const health = node.health ?? "ok";
  // The kind's computed fields (openChanges, zones), worked out as every face works them out.
  const computed = computedValues(store.schema, store.graph, node as never).values;
  const openChanges = Number(computed["openChanges"] ?? 0);
  const zones = Number(computed["zones"] ?? 0);

  return (
    <Page testId="capability-page">
      <Hero eyebrow={<Under context={context} node={node} what="Capability" />} title={facts.label} lede={node.statement}>
        <Badge tone={toneOfStatus(standing)}>{said(standing)}</Badge>
        <Badge tone={toneOfStatus(health)}>{health === "defective" ? "defective: an open fix targets this" : "healthy"}</Badge>
        {node.reviewed === true ? <Badge tone="good">spec reviewed</Badge> : <Badge>spec not yet reviewed</Badge>}
        {node.displayId ? <Badge plain>{node.displayId}</Badge> : null}
      </Hero>

      <Stats>
        <Stat i={0} value={node.criteriaCount ?? 0} label="criteria" />
        <Stat i={1} value={openChanges} label="open changes" tone={openChanges > 0 ? "accent" : undefined} />
        <Stat i={2} value={zones} label="zones realized in" hint={zones === 0 ? "no commit tied to its work yet" : undefined} />
        <Stat i={3} value={bound.length} label="constraints binding it" />
      </Stats>

      <Problems context={context} violations={facts.violations} />
      <DeclaredBlocks context={context} blocks={page.rest} from={1} only={(title) => title !== undefined} />

      <div className="ndx-two">
        <Section title="Needs" i={6}>
          {depends.length === 0 ? (
            <Empty>Depends on no other capability.</Empty>
          ) : (
            <Rows>
              {depends.map((d, i) => (
                <RecordRow key={d.id} context={context} node={d} i={i} />
              ))}
            </Rows>
          )}
        </Section>
        <Section title="Needed by" i={7}>
          {neededBy.length === 0 ? (
            <Empty>No capability depends on this one.</Empty>
          ) : (
            <Rows>
              {neededBy.map((d, i) => (
                <RecordRow key={d.id} context={context} node={d} i={i} />
              ))}
            </Rows>
          )}
        </Section>
      </div>

      <Section title="Facts" i={8}>
        <Facts fields={facts.fields.filter((f) => f.key !== "statement" && f.key !== "title")} />
        {facts.links.length > 0 ? (
          <p className="ndx-small ndx-muted" style={{ margin: 0 }}>
            Connected to{" "}
            {facts.links.map((g) => `${g.targets.length} ${g.description ?? g.edgeKind}`).join(", ")}.
          </p>
        ) : null}
      </Section>
      <p className="ndx-small ndx-muted" style={{ margin: 0 }}>
        <KindIcon context={context} kind="capability" /> {label(store, node)} · <Link to={recordPath(store.schema, "capability", id)}>this page</Link> ·{" "}
        <a href={`/scene#focus=${encodeURIComponent(id)}`}>see it on the map ↗</a>
      </p>
    </Page>
  );
}
