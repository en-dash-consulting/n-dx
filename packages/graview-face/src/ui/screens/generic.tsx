import type { Violation } from "@graview/core";
import { recordFacts, recordPath, useStoreTick } from "@graview/pages";
import { useState, type ReactNode } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import type { App } from "../../app.js";
import { current, label, node as nodeOf, nodesOf, noun, out, plural, type Node } from "../../model/graph.js";
import { DeclaredBlocks, declaredPage, opening } from "../declared.js";
import { Empty, Facts, Grid, Hero, Icon, KindIcon, Page, RecordCard, RecordRow, Rows, Section, type Ctx } from "../kit.js";

/**
 * EVERY OTHER KIND, IN THIS FACE'S DRESS. One list and one record for any
 * kind not given a page of its own, read through the same derivations the
 * framework's pages use (`readableFields`, `recordFacts`), so a kind declared
 * in n-dx tomorrow is drawn here without anyone writing its page.
 */
export function KindList({ context, kind }: { context: Ctx; app: App; kind: string }) {
  const { store } = context;
  useStoreTick(store);
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const past = params.get("past") === "1";
  const definition = store.schema.tryDefinition(kind);
  const all = nodesOf(store, kind);
  const live = all.filter((n) => current(store, n));
  const pastCount = all.length - live.length;
  const shown = (past ? all : live)
    .filter((n) => !q || label(store, n).toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => label(store, a).localeCompare(label(store, b), undefined, { numeric: true }));
  const set = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };
  const cards = kind === "area" || kind === "capability" || kind === "constraint" || kind === "release" || kind === "zone";

  return (
    <Page testId={`list-${kind}`}>
      <Hero eyebrow={plural(store, kind)} title={`${live.length} ${live.length === 1 ? noun(store, kind) : plural(store, kind).toLowerCase()}${pastCount ? `, ${pastCount} past` : ""}.`} lede={definition?.description}>
        <label className="ndx-find">
          <Icon name="search" />
          <span className="ndx-sr">Find {plural(store, kind).toLowerCase()}</span>
          <input
            value={q}
            placeholder={`Find ${plural(store, kind).toLowerCase()}…`}
            onChange={(e) => {
              setQ(e.target.value);
              set("q", e.target.value || null);
            }}
          />
        </label>
        {pastCount ? (
          <button type="button" className="ndx-pill" aria-pressed={past} onClick={() => set("past", past ? null : "1")}>
            {past ? "Hide the past" : `Show ${pastCount} past`}
          </button>
        ) : null}
      </Hero>
      {shown.length === 0 ? (
        <Empty>{q ? `Nothing called “${q}”.` : `No ${plural(store, kind).toLowerCase()} yet.`}</Empty>
      ) : cards ? (
        <Grid>
          {shown.slice(0, 120).map((n, i) => (
            <RecordCard key={n.id} context={context} node={n} i={i} />
          ))}
        </Grid>
      ) : (
        <Rows>
          {shown.slice(0, 200).map((n, i) => (
            <RecordRow key={n.id} context={context} node={n} i={i} />
          ))}
        </Rows>
      )}
      {shown.length > (cards ? 120 : 200) ? <p className="ndx-small ndx-muted">Showing the first {cards ? 120 : 200}; narrow with Find.</p> : null}
    </Page>
  );
}

export function KindRecord({ context, app, kind }: { context: Ctx; app: App; kind: string }) {
  const { store, principal, invariantContext } = context;
  useStoreTick(store);
  const id = decodeURIComponent(useParams()["id"] ?? "");
  const node = nodeOf(store, id);
  const facts = recordFacts(store, id, { ...(principal ? { principal } : {}), ...(invariantContext ? { context: invariantContext } : {}) });
  if (!node || !facts || node.kind !== kind) return <Missing context={context} />;
  const page = opening(declaredPage(context, app, node));
  const long = facts.fields.find((f) => f.long);

  return (
    <Page testId={`record-${kind}`} narrow>
      <Hero eyebrow={<Under context={context} node={node} what={noun(store, kind).replace(/^./, (c) => c.toUpperCase())} />} title={facts.label} lede={long?.value}>
        {current(store, node) ? null : <span className="ndx-badge warn">in the past: out of the picture, never out of the record</span>}
      </Hero>
      <Problems context={context} violations={facts.violations} />
      <DeclaredBlocks context={context} blocks={page.rest} from={1} />
      <Section title="Facts" i={4}>
        <Facts fields={facts.fields.filter((f) => f !== long)} />
      </Section>
      {facts.links.map((group, g) => (
        <Section key={`${group.edgeKind}|${group.direction}`} title={(group.description ?? group.edgeKind).replace(/^./, (c) => c.toUpperCase())} i={5 + g}>
          <Rows>
            {group.targets.slice(0, 40).map((t, i) => {
              const target = nodeOf(store, t.id);
              return target ? <RecordRow key={t.id} context={context} node={target} i={i} /> : <Link key={t.id} to={recordPath(store.schema, t.kind, t.id)}>{t.label}</Link>;
            })}
          </Rows>
          {group.targets.length > 40 ? <p className="ndx-small ndx-muted">and {group.targets.length - 40} more</p> : null}
        </Section>
      ))}
    </Page>
  );
}

/** Where a record sits: the chain of `under` above it, each a link. */
export function Under({ context, node, what }: { context: Ctx; node: Node; what: ReactNode }) {
  const { store } = context;
  const chain: Node[] = [];
  let cursor: Node | undefined = out(store, node.id, "under")[0];
  while (cursor && chain.length < 6) {
    chain.unshift(cursor);
    cursor = out(store, cursor.id, "under")[0];
  }
  return (
    <>
      <span>{what}</span>
      {chain.map((c) => (
        <span key={c.id}>
          · <Link to={recordPath(store.schema, c.kind, c.id)}>{label(store, c)}</Link>
        </span>
      ))}
    </>
  );
}

export function Problems({ violations }: { context: Ctx; violations: readonly Violation[] }) {
  if (violations.length === 0) return null;
  return (
    <div className="ndx-section" data-testid="record-violations">
      {violations.map((v, i) => (
        <div key={i} className="ndx-problem">
          <p>
            <b>{v.message}</b>
          </p>
          <p className="ndx-small ndx-muted">Rule: {v.invariant}. Edit the change or task here and it lands in n-dx; code-side records are fixed with their own tools.</p>
        </div>
      ))}
    </div>
  );
}

export function Missing({ context }: { context: Ctx }) {
  return (
    <Page narrow>
      <Hero eyebrow="Nothing here" title="Nothing lives at this address." lede="The record may have been pruned, or the projection re-emitted since this link was made.">
        <Link to="/" className="ndx-btn">
          <KindIcon context={context} kind="home" /> Home
        </Link>
      </Hero>
    </Page>
  );
}
