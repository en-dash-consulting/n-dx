import { pluralSlug, useStoreTick } from "@graview/pages";
import { Link } from "react-router-dom";
import { said, tokens, when } from "../../model/graph.js";
import { spend } from "../../model/spend.js";
import { attention } from "../../model/work.js";
import { Badge, Empty, Hero, Meter, Page, RecordRow, Rows, Section, Stat, Stats, type Ctx } from "../kit.js";

/** WHAT NEEDS A PERSON: the Inbox, blocked and failing work, defective capabilities. */
export function AttentionScreen({ context }: { context: Ctx }) {
  const { store } = context;
  useStoreTick(store);
  const needs = attention(store);
  return (
    <Page testId="attention">
      <Hero eyebrow="Overview" title={needs.total === 0 ? "Nothing needs a person right now." : `${needs.total} ${needs.total === 1 ? "thing needs" : "things need"} a person.`} lede="The Inbox waits for placement, blocked and failing work waits for a decision, and a defective capability has an open fix against it.">
        <Badge tone={needs.inbox.length ? "warn" : "good"}>{needs.inbox.length} in the Inbox</Badge>
        <Badge tone={needs.blocked.length ? "bad" : "good"}>{needs.blocked.length} blocked</Badge>
        <Badge tone={needs.failing.length ? "bad" : "good"}>{needs.failing.length} failing</Badge>
        <Badge tone={needs.defective.length ? "bad" : "good"}>{needs.defective.length} defective</Badge>
      </Hero>
      <Section title="In the Inbox" i={0} more={{ to: "/inbox", label: "The Inbox" }}>
        {needs.inbox.length === 0 ? <Empty>Nothing waits in the Inbox.</Empty> : <Rows>{needs.inbox.slice(0, 10).map((n, i) => <RecordRow key={n.id} context={context} node={n} i={i} end={<Badge plain>{said(n.priority ?? "")}</Badge>} />)}</Rows>}
      </Section>
      <Section title="Blocked" i={1}>
        {needs.blocked.length === 0 ? <Empty>Nothing is blocked.</Empty> : <Rows>{needs.blocked.map((n, i) => <RecordRow key={n.id} context={context} node={n} i={i} />)}</Rows>}
      </Section>
      <Section title="Failing" i={2}>
        {needs.failing.length === 0 ? <Empty>Nothing is failing.</Empty> : <Rows>{needs.failing.map((n, i) => <RecordRow key={n.id} context={context} node={n} i={i} />)}</Rows>}
      </Section>
      <Section title="Defective capabilities" i={3}>
        {needs.defective.length === 0 ? <Empty>Every capability reads ok.</Empty> : <Rows>{needs.defective.map((n, i) => <RecordRow key={n.id} context={context} node={n} i={i} end={<Badge tone="bad">defective</Badge>} />)}</Rows>}
      </Section>
    </Page>
  );
}

/** THE INBOX: changes a person has to place on the product map before they can be worked. */
export function InboxScreen({ context }: { context: Ctx }) {
  const { store } = context;
  useStoreTick(store);
  const { inbox } = attention(store);
  return (
    <Page testId="inbox" narrow>
      <Hero eyebrow="Work" title={inbox.length === 0 ? "The Inbox is empty." : `${inbox.length} ${inbox.length === 1 ? "change waits" : "changes wait"} in the Inbox.`} lede="A change lands here when it neither amends nor touches a product node. A person confirms what it targets; until then nothing autonomous picks it up.">
        <Link to={`/${pluralSlug(store.schema, "change")}`} className="ndx-btn quiet">
          All changes
        </Link>
      </Hero>
      {inbox.length === 0 ? <Empty command="ndx prd place <change> --amends <capability>">Nothing to place.</Empty> : <Rows>{inbox.map((n, i) => <RecordRow key={n.id} context={context} node={n} i={i} end={<Badge plain>{said(n.priority ?? "")}</Badge>} />)}</Rows>}
    </Page>
  );
}

/** SPEND: what the agent runs cost, where it went, and the runs that cost the most. */
export function SpendScreen({ context }: { context: Ctx }) {
  const { store } = context;
  useStoreTick(store);
  const money = spend(store);
  return (
    <Page testId="spend">
      <Hero eyebrow="Runs" title={`${tokens(money.total)} tokens across ${money.runs.length} runs.`} lede={`${tokens(money.week)} in the last seven days${money.running ? `; ${money.running} running now` : ""}. Tokens are what hench recorded per run: input, output and cache together.`} />
      <Stats>
        <Stat i={0} value={tokens(money.total)} label="tokens in all" />
        <Stat i={1} value={tokens(money.week)} label="this week" tone="accent" />
        <Stat i={2} value={money.runs.length} label="runs" />
        <Stat i={3} value={money.running} label="running now" tone={money.running ? "accent" : undefined} />
      </Stats>
      <div className="ndx-two">
        <Section title="By vendor" i={1}>
          {money.byVendor.length === 0 ? <Empty command="ndx work .">No runs recorded yet.</Empty> : money.byVendor.map((v) => <Meter key={v.vendor} value={v.tokens} max={money.total || 1} label={`${v.vendor} · ${v.runs} runs`} text={tokens(v.tokens)} />)}
        </Section>
        <Section title="By outcome" i={2}>
          {money.byOutcome.map((o) => (
            <Meter key={o.status} value={o.tokens} max={money.total || 1} label={`${said(o.status)} · ${o.runs} runs`} text={tokens(o.tokens)} tone={o.status === "completed" ? "good" : o.status === "running" ? "accent" : "bad"} />
          ))}
        </Section>
      </div>
      <Section title="Costliest runs" i={3}>
        {money.costliest.length === 0 ? <Empty>No runs recorded yet.</Empty> : <Rows>{money.costliest.map((r, i) => <RecordRow key={r.id} context={context} node={r} i={i} sub={`${String(r.vendor ?? "")} ${String(r.model ?? "")} · ${when(r.startedAt)}`} end={<Badge plain>{tokens(Number(r.tokens) || 0)}</Badge>} />)}</Rows>}
      </Section>
    </Page>
  );
}
