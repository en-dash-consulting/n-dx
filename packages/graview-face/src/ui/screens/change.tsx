import { recordFacts, useStoreTick } from "@graview/pages";
import { useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import type { App } from "../../app.js";
import { inward, isOpen, label, node as nodeOf, nodesOf, out, said, STATUS_ORDER, toneOfStatus, tokens, when, type Node } from "../../model/graph.js";
import { orderChanges, runsFor, workUnder } from "../../model/work.js";
import { DeclaredBlocks, declaredPage, opening } from "../declared.js";
import { Badge, Empty, Facts, Hero, Icon, Page, RecordRow, Rows, Section, Stat, Stats, StatusBadge, type Ctx } from "../kit.js";
import { Missing, Problems, Under } from "./generic.js";

/** A CHANGE'S PAGE: the intent, what it rewrites, the work under it, the runs that worked it and what it waits for. */
export function ChangeScreen({ context, app }: { context: Ctx; app: App }) {
  const { store, principal, invariantContext } = context;
  useStoreTick(store);
  const id = decodeURIComponent(useParams()["id"] ?? "");
  const node = nodeOf(store, id);
  const facts = recordFacts(store, id, { ...(principal ? { principal } : {}), ...(invariantContext ? { context: invariantContext } : {}) });
  if (!node || !facts || node.kind !== "change") return <Missing context={context} />;

  const page = opening(declaredPage(context, app, node));
  const work = workUnder(store, id);
  const runs = runsFor(store, id);
  const waits = out(store, id, "blockedBy");
  const waiting = inward(store, id, "blockedBy");
  const depthOf = new Map<string, number>();
  const depth = (n: Node): number => {
    const parent = out(store, n.id, "under")[0];
    if (!parent || parent.id === id) return 0;
    return (depthOf.get(parent.id) ?? depth(parent)) + 1;
  };
  for (const w of work) depthOf.set(w.id, depth(w));
  const spent = runs.reduce((t, r) => t + (Number(r.tokens) || 0), 0);
  const [allWork, setAllWork] = useState(false);
  const WORK_SHOWN = 30;
  const shownWork = allWork ? work : work.filter(isOpen).concat(work.filter((w) => !isOpen(w))).slice(0, WORK_SHOWN);
  const eyebrow = [node.changeKind, node.level && node.level !== "change" ? `was ${String(node.level)} on v1` : undefined, node.displayId].filter(Boolean).map(String);

  return (
    <Page testId="change-page">
      <Hero eyebrow={<Under context={context} node={node} what={`Change${eyebrow.length ? ` · ${eyebrow.join(" · ")}` : ""}`} />} title={facts.label} lede={typeof node.intent === "string" ? node.intent : undefined}>
        <StatusBadge status={node.status} />
        {node.priority ? <Badge plain>{said(node.priority)} priority</Badge> : null}
        {node.inbox === true ? <Badge tone="warn">in the Inbox: a person confirms what it targets</Badge> : null}
        {node.fix === true ? <Badge tone="warn">fix</Badge> : null}
        {node.spike === true ? <Badge>spike</Badge> : null}
        {node.plannedRelease ? <Badge plain>planned for {String(node.plannedRelease)}</Badge> : null}
        {node.shippedIn ? <Badge tone="good">shipped in {String(node.shippedIn)}</Badge> : null}
      </Hero>

      <Stats>
        <Stat i={0} value={work.filter(isOpen).length} label="open work items" hint={`${work.length} in all`} tone={work.some(isOpen) ? "accent" : undefined} />
        <Stat i={1} value={runs.length} label="agent runs" hint={runs[0] ? `last ${when(runs[0].startedAt)}` : undefined} />
        <Stat i={2} value={tokens(spent)} label="tokens spent" />
        <Stat i={3} value={waits.length} label="waits for" tone={waits.some(isOpen) ? "warn" : undefined} />
      </Stats>

      <Problems context={context} violations={facts.violations} />
      <div className="ndx-two">
        <DeclaredBlocks context={context} blocks={page.rest} from={1} only={(title) => title === "Rewrites" || title === "Works on"} />
      </div>

      <Section title="Work under this change" i={6} testId="change-work">
        {work.length === 0 ? (
          <Empty command="ndx work --task=<id> .">No tasks under this change: the change itself is the unit of work.</Empty>
        ) : (
          <>
            <Rows>
              {shownWork.map((w, i) => (
                <RecordRow key={w.id} context={context} node={w} i={i} depth={allWork ? (depthOf.get(w.id) ?? 0) : 0} />
              ))}
            </Rows>
            {work.length > WORK_SHOWN ? (
              <button type="button" className="ndx-btn quiet" onClick={() => setAllWork(!allWork)} style={{ justifySelf: "start" }}>
                {allWork ? `Show the ${WORK_SHOWN} that matter most` : `Show all ${work.length}, nested`}
              </button>
            ) : null}
          </>
        )}
      </Section>

      <div className="ndx-two">
        <Section title="Runs" i={7}>
          {runs.length === 0 ? (
            <Empty command="ndx work .">No run has worked this yet.</Empty>
          ) : (
            <Rows>
              {runs.slice(0, 12).map((r, i) => (
                <RecordRow key={r.id} context={context} node={r} i={i} sub={`${String(r.vendor ?? "")} ${String(r.model ?? "")} · ${when(r.startedAt)} · ${tokens(Number(r.tokens) || 0)} tokens`} />
              ))}
            </Rows>
          )}
        </Section>
        <Section title={waits.length || waiting.length ? "Order" : "Waits for nothing"} i={8}>
          {waits.length === 0 && waiting.length === 0 ? (
            <Empty>Nothing has to finish first, and nothing is waiting on this.</Empty>
          ) : (
            <>
              {waits.length ? <h3 className="ndx-h3 ndx-muted">Waits for</h3> : null}
              <Rows>
                {waits.map((w, i) => (
                  <RecordRow key={w.id} context={context} node={w} i={i} />
                ))}
              </Rows>
              {waiting.length ? <h3 className="ndx-h3 ndx-muted">Waiting on this</h3> : null}
              <Rows>
                {waiting.map((w, i) => (
                  <RecordRow key={w.id} context={context} node={w} i={i} />
                ))}
              </Rows>
            </>
          )}
        </Section>
      </div>

      <Section title="Facts" i={9}>
        <Facts fields={facts.fields.filter((f) => f.key !== "intent" && f.key !== "title")} />
      </Section>
    </Page>
  );
}

const FILTERS: { key: string; label: string; test: (n: Node) => boolean }[] = [
  { key: "open", label: "Open", test: isOpen },
  { key: "in_progress", label: "In progress", test: (n) => n.status === "in_progress" },
  { key: "inbox", label: "Inbox", test: (n) => n.inbox === true },
  { key: "blocked", label: "Blocked", test: (n) => n.status === "blocked" || n.status === "failing" },
  { key: "pending", label: "Pending", test: (n) => n.status === "pending" },
  { key: "done", label: "Done", test: (n) => n.status === "completed" },
  { key: "all", label: "All", test: () => true },
];

/** THE CHANGES LIST: filter by status, find by name, grouped by status when nothing is filtered. */
export function ChangesScreen({ context }: { context: Ctx }) {
  const { store } = context;
  useStoreTick(store);
  const [params, setParams] = useSearchParams();
  const filter = params.get("filter") ?? "open";
  const [q, setQ] = useState(params.get("q") ?? "");
  const all = nodesOf(store, "change");
  const active = FILTERS.find((f) => f.key === filter) ?? FILTERS[0]!;
  const shown = orderChanges(all.filter(active.test).filter((n) => !q || label(store, n).toLowerCase().includes(q.toLowerCase())));
  const set = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };
  const groups = filter === "open" || filter === "all" ? [...new Set(shown.map((n) => String(n.status ?? "pending")))].sort((a, b) => STATUS_ORDER.indexOf(a) - STATUS_ORDER.indexOf(b)) : null;

  return (
    <Page testId="list-change">
      <Hero eyebrow="Work" title={`${shown.length} ${shown.length === 1 ? "change" : "changes"}${filter === "all" ? "" : ` ${active.label.toLowerCase()}`}${q ? ` called “${q}”` : ""}.`} lede="A change is a unit of intent: why something is changing, what it rewrites, and when it ships. Tasks run under it.">
        <label className="ndx-find">
          <Icon name="search" />
          <span className="ndx-sr">Find changes</span>
          <input
            value={q}
            placeholder="Find a change…"
            onChange={(e) => {
              setQ(e.target.value);
              set("q", e.target.value || null);
            }}
          />
        </label>
        <div className="ndx-pills" role="group" aria-label="Filter changes">
          {FILTERS.map((f) => (
            <button key={f.key} type="button" className="ndx-pill" aria-pressed={f.key === filter} onClick={() => set("filter", f.key === "open" ? null : f.key)}>
              {f.label}
              <span className="ndx-count">{all.filter(f.test).length}</span>
            </button>
          ))}
        </div>
      </Hero>
      {shown.length === 0 ? (
        <Empty command={filter === "inbox" ? undefined : "ndx plan ."}>{q ? `Nothing called “${q}”.` : filter === "inbox" ? "Nothing waits in the Inbox." : "No changes here."}</Empty>
      ) : groups ? (
        groups.map((status, g) => (
          <Section key={status} title={`${said(status).replace(/^./, (c) => c.toUpperCase())}`} i={g}>
            <Rows>
              {shown
                .filter((n) => String(n.status ?? "pending") === status)
                .slice(0, 60)
                .map((n, i) => (
                  <RecordRow key={n.id} context={context} node={n} i={i} end={<Badge tone={toneOfStatus(n.priority)} plain>{said(n.priority ?? "")}</Badge>} />
                ))}
            </Rows>
            {shown.filter((n) => String(n.status ?? "pending") === status).length > 60 ? <p className="ndx-small ndx-muted">Showing 60; narrow with Find.</p> : null}
          </Section>
        ))
      ) : (
        <Rows>
          {shown.slice(0, 120).map((n, i) => (
            <RecordRow key={n.id} context={context} node={n} i={i} />
          ))}
        </Rows>
      )}
    </Page>
  );
}
