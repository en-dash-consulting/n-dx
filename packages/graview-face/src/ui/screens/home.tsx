import { placesOf } from "@graview/core";
import { pluralSlug, useStoreTick } from "@graview/pages";
import { Link } from "react-router-dom";
import type { App } from "../../app.js";
import { tokens } from "../../model/graph.js";
import { fragileZones } from "../../model/code.js";
import { spend } from "../../model/spend.js";
import { attention, standing } from "../../model/work.js";
import { DeclaredBlocks, declaredHome, opening } from "../declared.js";
import { Badge, Grid, Hero, Icon, Page, RecordRow, Rows, Section, Stat, Stats, at, type Ctx } from "../kit.js";

/**
 * THE HOME, WRITTEN ONCE. Its sentence and its lists are the declared home
 * from n-dx.graview.json, worked out by Graview; what this screen adds is the
 * figures a product needs at a glance (standing, spend, attention), the
 * pictures, and the zones n-dx's own governance rule flags.
 */
export function HomeScreen({ context, app }: { context: Ctx; app: App }) {
  const { store } = context;
  useStoreTick(store);
  const home = opening(declaredHome(context, app));
  const s = standing(store);
  const needs = attention(store);
  const money = spend(store);
  const fragile = fragileZones(store);
  const pictures = placesOf(app).filter((p) => p.lens);
  const hasProduct = s.capabilities > 0 || s.areas > 0;

  return (
    <Page testId="home">
      <Hero
        eyebrow={<span>{app.name} · on Graview</span>}
        title={hasProduct && home.headline ? home.headline : `${s.open} ${s.open === 1 ? "change" : "changes"} open${s.inProgress ? `, ${s.inProgress} in progress` : ""}.`}
        lede={home.sentences.join(" ")}
      >
        {needs.total > 0 ? (
          <Link to="/attention" className="ndx-btn">
            <Icon name="attention" /> {needs.total} need attention
          </Link>
        ) : (
          <Badge tone="good">Nothing needs a person right now</Badge>
        )}
        <a className="ndx-btn quiet" href="/scene">
          <Icon name="scene" /> Open the map
        </a>
      </Hero>

      <Stats>
        {hasProduct ? <Stat i={0} value={`${s.met}/${s.capabilities}`} label="capabilities met" tone={s.capabilities > 0 && s.met === s.capabilities ? "good" : "accent"} /> : null}
        <Stat i={1} value={s.open} label="changes open" tone="accent" hint={`${s.inProgress} in progress`} />
        <Stat i={2} value={needs.inbox.length} label="in the Inbox" tone={needs.inbox.length ? "warn" : undefined} />
        <Stat i={3} value={money.runs.length} label="agent runs" hint={money.running ? `${money.running} running now` : undefined} />
        <Stat i={4} value={tokens(money.total)} label="tokens spent" hint={money.week ? `${tokens(money.week)} this week` : undefined} />
        {needs.defective.length ? <Stat i={5} value={needs.defective.length} label="defective capabilities" tone="bad" /> : null}
      </Stats>

      {!hasProduct ? (
        <Section title="The product map is not drawn yet" i={1}>
          <div className="ndx-empty">
            <p>
              This PRD is on the v1 layout: its epics and features read as changes, and there are no areas, capabilities or constraints to stand them on.
              The map arrives when the PRD moves to the v2 layout (rex's migration plan draws the areas and capabilities from the epics and the code).
            </p>
          </div>
        </Section>
      ) : null}

      <DeclaredBlocks context={context} blocks={home.rest.filter((b) => b.t !== "group" && b.t !== "number")} from={2} />

      {pictures.length > 0 ? (
        <Section title="Pictures" i={8}>
          <Grid>
            {pictures.map((place, i) => (
              <Link key={place.slug} to={place.address} className="ndx-place ndx-rise" style={at(i)}>
                <b>{place.title}</b>
                <span>
                  {place.lens} over {place.kind ? pluralSlug(store.schema, place.kind).replace(/-/g, " ") : "everything"}
                </span>
              </Link>
            ))}
          </Grid>
        </Section>
      ) : null}

      {fragile.length > 0 ? (
        <Section title="Fragile zones" i={9} more={{ to: `/${pluralSlug(store.schema, "zone")}`, label: "All zones" }}>
          <p className="ndx-small ndx-muted" style={{ margin: 0 }}>
            Cohesion under 0.5 and coupling over 0.5: n-dx's dual-fragility rule. These need a reason for every change that touches them.
          </p>
          <Rows>
            {fragile.slice(0, 6).map((zone, i) => (
              <RecordRow key={zone.id} context={context} node={zone} i={i} end={<Badge tone="bad">fragile</Badge>} sub={`cohesion ${Math.round(Number(zone.cohesion) * 100)}% · coupling ${Math.round(Number(zone.coupling) * 100)}%`} />
            ))}
          </Rows>
        </Section>
      ) : null}
    </Page>
  );
}
