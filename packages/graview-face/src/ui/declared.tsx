/**
 * THE DECLARED HOME AND RECORD PAGES, WORKED OUT BY GRAVIEW AND DRAWN HERE.
 * The words, numbers and lists come from the blocks the n-dx document writes
 * (`views.home`, `views.<kind>.page`), resolved by `resolveFor` over what
 * this seat may see — the same resolution the scene, `describe_place` and
 * the embed use, under a page's budget — so this face can never say a figure
 * the rest disagrees with. Each resolved block carries the key the document
 * gave it, and a screen claims a section by that key, never by its words.
 * Only the look is ours.
 */
import type { ResolvedBlock } from "@graview/core/blocks";
import { resolveFor } from "@graview/core/describe";
import type { ReactNode } from "react";
import type { App } from "../app.js";
import type { Node, Tone } from "../model/graph.js";
import { Badge, Empty, Grid, Meter, RecordCard, RecordRow, Rows, Section, Stat, Stats, type Ctx } from "./kit.js";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function declaredHome(context: Ctx, app: App): readonly ResolvedBlock[] {
  return resolveFor(context.store, context.principal ?? null, null, { app, today: today(), firstHeading: 1 });
}

export function declaredPage(context: Ctx, app: App, node: Node): readonly ResolvedBlock[] {
  return resolveFor(context.store, context.principal ?? null, node, { app, today: today() });
}

/** The opening of a declared view: its first headline and the sentences that follow it. The rest is drawn by `DeclaredBlocks`. */
export function opening(blocks: readonly ResolvedBlock[]): { headline?: string; sentences: string[]; rest: readonly ResolvedBlock[] } {
  const first = blocks.findIndex((b) => b.t === "headline");
  if (first < 0) return { sentences: [], rest: blocks };
  const head = blocks[first] as Extract<ResolvedBlock, { t: "headline" }>;
  const sentences: string[] = [];
  let i = first + 1;
  for (; i < blocks.length; i++) {
    const b = blocks[i]!;
    if (b.t !== "text") break;
    sentences.push(b.text);
  }
  return { headline: head.text, sentences, rest: [...blocks.slice(0, first), ...blocks.slice(i)] };
}

const TONE: Record<string, Tone | undefined> = { good: "good", warn: "warn", bad: "bad", accent: "accent", neutral: "neutral" };

/**
 * Resolved blocks, in this face's hand. A `title` opens a section that holds
 * what follows until the next title, and the section answers to the title's
 * key (`"key": "rewrites"` in the document); `only` keeps the sections whose
 * key it says yes to — the leading, untitled run of blocks has none.
 */
export function DeclaredBlocks({ context, blocks, from = 0, only }: { context: Ctx; blocks: readonly ResolvedBlock[]; from?: number; only?: (key: string | undefined) => boolean }) {
  const all: { key?: string; title?: string; blocks: ResolvedBlock[] }[] = [{ blocks: [] }];
  for (const block of blocks) {
    if (block.t === "title") all.push({ key: block.key, title: block.text, blocks: [] });
    else all[all.length - 1]!.blocks.push(block);
  }
  const sections = only ? all.filter((s) => only(s.key)) : all;
  return (
    <>
      {sections.map((section, s) =>
        section.blocks.length === 0 ? null : section.title ? (
          <Section key={section.key ?? s} title={section.title} i={from + s} testId={section.key ? `declared-${section.key}` : undefined}>
            <Blocks context={context} blocks={section.blocks} />
          </Section>
        ) : (
          <Blocks key={s} context={context} blocks={section.blocks} />
        ),
      )}
    </>
  );
}

function Blocks({ context, blocks }: { context: Ctx; blocks: readonly ResolvedBlock[] }) {
  return (
    <>
      {blocks.map((block, k) => (
        <Block key={block.key ?? k} context={context} block={block} />
      ))}
    </>
  );
}

function Block({ context, block }: { context: Ctx; block: ResolvedBlock }): ReactNode {
  switch (block.t) {
    case "headline":
      return <h2 className="ndx-h2">{block.text}</h2>;
    case "text":
      return <p className="ndx-prose">{block.text}</p>;
    case "number":
      return (
        <Stats>
          <Stat value={block.text} label={block.label ?? ""} />
        </Stats>
      );
    case "badge":
      return <Badge tone={TONE[block.tone]}>{block.text}</Badge>;
    case "field":
      return (
        <p className="ndx-meta">
          <span>
            {block.label}: <b>{block.text}</b>
          </span>
        </p>
      );
    case "progress":
      return <Meter value={block.value ?? 0} max={block.max ?? 1} label={block.label} text={block.text} />;
    case "divider":
      return <hr className="ndx-hr" />;
    case "group": {
      const numbers = block.blocks.every((b) => b.t === "number");
      if (numbers) {
        return (
          <Stats>
            {block.blocks.map((b, i) => (b.t === "number" ? <Stat key={b.key ?? i} value={b.text} label={b.label ?? ""} i={i} /> : null))}
          </Stats>
        );
      }
      return (
        <div className={block.direction === "row" ? "ndx-badges" : "ndx-section"}>
          <Blocks context={context} blocks={block.blocks} />
        </div>
      );
    }
    case "when":
      return block.shown ? <Blocks context={context} blocks={block.blocks} /> : null;
    case "list":
      return <DeclaredList context={context} list={block} />;
    case "title":
    case "figure":
      return null;
  }
}

function DeclaredList({ context, list }: { context: Ctx; list: Extract<ResolvedBlock, { t: "list" }> }) {
  if (list.failed) return <Empty>—</Empty>;
  if (list.members.length === 0) return <Empty>{list.empty ?? "Nothing here yet."}</Empty>;
  const groups = list.groups ?? [{ value: null, members: list.members }];
  return (
    <div className="ndx-section">
      {groups.map((group, g) =>
        group.members.length === 0 ? null : (
          <div key={g} className="ndx-section">
            {group.heading ? <h3 className="ndx-h3 ndx-muted">{group.heading}</h3> : null}
            {list.as === "card" ? (
              <Grid>
                {group.members.map((member, i) => (
                  <RecordCard key={member.id} context={context} node={member as unknown as Node} i={i} />
                ))}
              </Grid>
            ) : (
              <Rows>
                {group.members.map((member, i) => (
                  <RecordRow key={member.id} context={context} node={member as unknown as Node} i={i} />
                ))}
              </Rows>
            )}
          </div>
        ),
      )}
      {list.more > 0 ? <p className="ndx-small ndx-muted">and {list.more} more</p> : null}
    </div>
  );
}
