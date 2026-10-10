import { recordFacts, useStoreTick } from "@graview/pages";
import { useParams } from "react-router-dom";
import type { App } from "../../app.js";
import { node as nodeOf, out, said, toneOfStatus, tokens, when } from "../../model/graph.js";
import { DeclaredBlocks, declaredPage, opening } from "../declared.js";
import { Badge, Empty, Facts, Hero, Meter, Page, RecordRow, Rows, Section, Stat, Stats, type Ctx } from "../kit.js";
import { Missing } from "./generic.js";

function duration(start: unknown, end: unknown): string | undefined {
  if (typeof start !== "string" || typeof end !== "string") return undefined;
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (!Number.isFinite(ms) || ms < 0) return undefined;
  const m = Math.round(ms / 60_000);
  return m < 1 ? "under a minute" : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

/** A RUN'S PAGE: what it worked, what it cost, what it left behind. */
export function RunScreen({ context, app }: { context: Ctx; app: App }) {
  const { store, principal } = context;
  useStoreTick(store);
  const id = decodeURIComponent(useParams()["id"] ?? "");
  const node = nodeOf(store, id);
  const facts = recordFacts(store, id, principal ? { principal } : {});
  if (!node || !facts || node.kind !== "run") return <Missing context={context} />;

  const page = opening(declaredPage(context, app, node));
  const workedOn = out(store, id, "ranFor");
  const commits = out(store, id, "produced");
  const total = Number(node.tokens) || 0;
  const input = Number(node.inputTokens) || 0;
  const output = Number(node.outputTokens) || 0;
  const took = duration(node.startedAt, node.finishedAt);

  return (
    <Page testId="run-page" narrow>
      <Hero eyebrow={<span>Run · {String(node.vendor ?? "")} {String(node.model ?? "")}</span>} title={facts.label} lede={`Started ${when(node.startedAt)}${took ? `, took ${took}` : node.status === "running" ? ", still running" : ""}${node.branch ? ` on ${String(node.branch)}` : ""}.`}>
        <Badge tone={toneOfStatus(node.status)}>{said(node.status)}</Badge>
        {node.id ? <Badge plain>{String(node.id).slice(0, 8)}</Badge> : null}
      </Hero>

      <Stats>
        <Stat i={0} value={tokens(total)} label="tokens" />
        <Stat i={1} value={Number(node.turns ?? 0)} label="turns" />
        <Stat i={2} value={Number(node.filesChanged ?? 0)} label="files changed" />
        <Stat i={3} value={commits.length} label="commits" />
      </Stats>

      {total > 0 ? (
        <Section title="Where the tokens went" i={1}>
          <Meter value={input} max={total} label="Input" text={tokens(input)} />
          <Meter value={output} max={total} label="Output" text={tokens(output)} />
          {total - input - output > 0 ? <Meter value={total - input - output} max={total} label="Cache" text={tokens(total - input - output)} /> : null}
        </Section>
      ) : null}

      <Section title="Worked on" i={2}>
        {workedOn.length === 0 ? <Empty>The work this run was for is no longer in the tree.</Empty> : <Rows>{workedOn.map((w, i) => <RecordRow key={w.id} context={context} node={w} i={i} />)}</Rows>}
      </Section>
      <Section title="Commits" i={3}>
        {commits.length === 0 ? <Empty>No commit recorded for this run.</Empty> : <Rows>{commits.map((c, i) => <RecordRow key={c.id} context={context} node={c} i={i} sub={String(c.sha ?? "").slice(0, 12)} end={null} />)}</Rows>}
      </Section>
      <DeclaredBlocks context={context} blocks={page.rest.filter((b) => b.t !== "list" && b.t !== "group")} from={4} />
      <Section title="Facts" i={5}>
        <Facts fields={facts.fields.filter((f) => f.key !== "taskTitle")} />
      </Section>
    </Page>
  );
}
