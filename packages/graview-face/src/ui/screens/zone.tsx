import { recordFacts, useStoreTick } from "@graview/pages";
import { useParams } from "react-router-dom";
import type { App } from "../../app.js";
import { crossings, isFragile } from "../../model/code.js";
import { inward, node as nodeOf, out } from "../../model/graph.js";
import { Badge, Empty, Facts, Hero, Meter, Page, RecordRow, Rows, Section, Stat, Stats, type Ctx } from "../kit.js";
import { Missing, Under } from "./generic.js";

/** A ZONE'S PAGE: how tightly it holds, how much it leans on others, and which capabilities landed here. */
export function ZoneScreen({ context }: { context: Ctx; app: App }) {
  const { store, principal } = context;
  useStoreTick(store);
  const id = decodeURIComponent(useParams()["id"] ?? "");
  const node = nodeOf(store, id);
  const facts = recordFacts(store, id, principal ? { principal } : {});
  if (!node || !facts || node.kind !== "zone") return <Missing context={context} />;

  const cohesion = Number(node.cohesion) || 0;
  const coupling = Number(node.coupling) || 0;
  const fragile = isFragile(node);
  const { imports, importedBy } = crossings(store, id);
  const inside = inward(store, id, "under");
  const components = inward(store, id, "inZone").filter((n) => n.kind === "component");
  const files = inward(store, id, "inZone").filter((n) => n.kind === "file");
  const realized = inward(store, id, "realizedIn");
  const parent = out(store, id, "under")[0];

  return (
    <Page testId="zone-page">
      <Hero eyebrow={<Under context={context} node={node} what={`Zone${parent ? "" : " · top level"}`} />} title={facts.label} lede={typeof node.description === "string" ? node.description : undefined}>
        {fragile ? <Badge tone="bad">fragile: cohesion under 0.5 and coupling over 0.5</Badge> : <Badge tone="good">holds together</Badge>}
        <Badge plain>{Number(node.fileCount ?? 0)} files</Badge>
        {node.depth ? <Badge plain>depth {String(node.depth)}</Badge> : null}
      </Hero>

      <Stats>
        <Stat i={0} value={`${Math.round(cohesion * 100)}%`} label="cohesion" tone={cohesion < 0.5 ? "warn" : "good"} hint="how much of its imports stay inside" />
        <Stat i={1} value={`${Math.round(coupling * 100)}%`} label="coupling" tone={coupling > 0.5 ? "warn" : "good"} hint="how much it leans on other zones" />
        <Stat i={2} value={imports.length} label="imports from" />
        <Stat i={3} value={importedBy.length} label="imported by" />
        <Stat i={4} value={realized.length} label="capabilities realized here" tone={realized.length ? "accent" : undefined} />
      </Stats>

      <div className="ndx-two">
        <Section title="Shape" i={1}>
          <Meter value={cohesion} label="Cohesion" tone={cohesion < 0.5 ? "warn" : "good"} />
          <Meter value={coupling} label="Coupling" tone={coupling > 0.5 ? "bad" : "good"} />
          {Array.isArray(node.entryPoints) && node.entryPoints.length > 0 ? (
            <>
              <h3 className="ndx-h3 ndx-muted">Entry points</h3>
              <ul style={{ margin: 0, paddingLeft: "1.1rem" }}>
                {(node.entryPoints as string[]).slice(0, 12).map((p) => (
                  <li key={p} className="ndx-mono">
                    {p}
                  </li>
                ))}
              </ul>
              {(node.entryPoints as string[]).length > 12 ? <p className="ndx-small ndx-muted">and {(node.entryPoints as string[]).length - 12} more</p> : null}
            </>
          ) : null}
        </Section>
        <Section title="Capabilities realized here" i={2}>
          {realized.length === 0 ? <Empty>No capability's commits have touched this zone, or no commit carries an N-DX-Item trailer yet.</Empty> : <Rows>{realized.map((c, i) => <RecordRow key={c.id} context={context} node={c} i={i} />)}</Rows>}
        </Section>
      </div>

      <div className="ndx-two">
        <Section title="Imports from" i={3}>
          {imports.length === 0 ? <Empty>Imports from no other zone.</Empty> : <Rows>{imports.map((z, i) => <RecordRow key={z.id} context={context} node={z} i={i} sub={`cohesion ${Math.round(Number(z.cohesion) * 100)}% · coupling ${Math.round(Number(z.coupling) * 100)}%`} end={isFragile(z) ? <Badge tone="bad">fragile</Badge> : null} />)}</Rows>}
        </Section>
        <Section title="Imported by" i={4}>
          {importedBy.length === 0 ? <Empty>No zone imports from this one.</Empty> : <Rows>{importedBy.map((z, i) => <RecordRow key={z.id} context={context} node={z} i={i} sub={`cohesion ${Math.round(Number(z.cohesion) * 100)}% · coupling ${Math.round(Number(z.coupling) * 100)}%`} end={isFragile(z) ? <Badge tone="bad">fragile</Badge> : null} />)}</Rows>}
        </Section>
      </div>

      {inside.length > 0 ? (
        <Section title="Zones inside" i={5}>
          <Rows>{inside.map((z, i) => <RecordRow key={z.id} context={context} node={z} i={i} sub={`${Number(z.fileCount ?? 0)} files · cohesion ${Math.round(Number(z.cohesion) * 100)}%`} end={isFragile(z) ? <Badge tone="bad">fragile</Badge> : null} />)}</Rows>
        </Section>
      ) : null}


      <Section title={`Components${components.length ? ` (${components.length})` : ""}`} i={7}>
        {components.length === 0 ? <Empty command="ndx analyze .">No components catalogued here.</Empty> : <Rows>{components.slice(0, 40).map((c, i) => <RecordRow key={c.id} context={context} node={c} i={i} sub={String(c.file ?? "")} end={<Badge plain>{String(c.role ?? "")}</Badge>} />)}</Rows>}
        {components.length > 40 ? <p className="ndx-small ndx-muted">and {components.length - 40} more</p> : null}
      </Section>
      {files.length > 0 ? (
        <Section title={`Files (${files.length})`} i={8}>
          <Rows>{files.slice(0, 40).map((f, i) => <RecordRow key={f.id} context={context} node={f} i={i} sub={`${String(f.language ?? "")} · ${Number(f.lineCount ?? 0)} lines`} end={null} />)}</Rows>
        </Section>
      ) : null}
      <Section title="Facts" i={9}>
        <Facts fields={facts.fields.filter((f) => f.key !== "description" && f.key !== "name" && f.key !== "entryPoints")} />
      </Section>
    </Page>
  );
}
