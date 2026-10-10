/**
 * THE FRAME AROUND EVERY ROUTE: a rail in n-dx's words. Product, Work, Code,
 * Runs; Needs attention with its count; the Pictures the declaration titles,
 * listed from `placesOf` so a lens added in n-dx.graview.json shows up here
 * with no edit to this file. Every kind is reachable — the hidden ones
 * (commits, components, files) under "Everything else". Graview's own bar
 * stays above: the face switch, Find, the standing and the person are its.
 */
import { placesOf } from "@graview/core";
import { pluralSlug, useStoreTick } from "@graview/pages";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import type { App } from "../app.js";
import { count, current, nodesOf, plural } from "../model/graph.js";
import { attention } from "../model/work.js";
import { CSS } from "./css.js";
import { SyncStatusLine } from "./sync-status.js";
import { Icon, type Ctx } from "./kit.js";

function Item({ to, icon, label, count: n, warn, here, hue }: { to: string; icon: string; label: string; count?: number; warn?: boolean; here: string; hue?: number }) {
  const isHere = to === "/" ? here === "/" : here === to || here.startsWith(`${to}/`);
  return (
    <Link to={to} {...(isHere ? { "aria-current": "page" as const } : {})}>
      <Icon name={icon} className={hue === undefined ? undefined : "ndx-kind"} style={hue === undefined ? undefined : ({ ["--hue" as string]: hue } as React.CSSProperties)} />
      {label}
      {n !== undefined && n > 0 ? <span className={`ndx-count${warn ? " warn" : ""}`}>{n}</span> : null}
    </Link>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="ndx-group">
      <h2>{title}</h2>
      <nav className="ndx-nav" aria-label={title}>
        {children}
      </nav>
    </div>
  );
}

export function shell(app: App) {
  const PRODUCT = ["area", "capability", "constraint"];
  const WORK = ["change", "task", "release"];
  const CODE = ["zone", "component"];
  const RUNS = ["run", "commit"];
  const pictures = placesOf(app).filter((p) => p.lens);

  return function NdxShell({ context, children }: { context: Ctx; children: ReactNode }) {
    const { store } = context;
    useStoreTick(store);
    const here = useLocation().pathname;
    const needs = attention(store);
    const hue = (kind: string) => (app.brand?.accents as Record<string, number> | undefined)?.[kind];
    const kinds = store.schema.kinds as readonly string[];
    const named = new Set([...PRODUCT, ...WORK, ...CODE, ...RUNS]);
    const live = (kind: string) => count(store, kind, (n) => current(store, n));
    const main = useRef<HTMLElement>(null);
    const [rail, setRail] = useState<HTMLElement | null>(null);
    useLayoutEffect(() => {
      // On a phone the rail is a bar that scrolls sideways: the current page glides into view.
      const el = rail?.querySelector<HTMLElement>('a[aria-current="page"]');
      if (!rail || !el || rail.scrollWidth <= rail.clientWidth + 1) return;
      el.scrollIntoView({ inline: "center", block: "nearest", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    }, [here, rail]);

    const kindItem = (kind: string) =>
      kinds.includes(kind) ? <Item key={kind} to={`/${pluralSlug(store.schema, kind)}`} icon={kind} label={plural(store, kind)} count={nodesOf(store, kind).length ? live(kind) : undefined} here={here} hue={hue(kind)} /> : null;

    return (
      <div className="ndx">
        <style>{CSS}</style>
        <aside className="ndx-rail" aria-label={app.name} ref={setRail} data-graview-foot="">
          <Link to="/" className="ndx-brand" aria-label={`${app.name}: home`}>
            {app.brand?.logo && typeof app.brand.logo === "string" ? <span dangerouslySetInnerHTML={{ __html: app.brand.logo }} style={{ display: "contents" }} /> : <Icon name="scene" />}
            <span>
              <b>{app.name}</b>
              <small>on Graview</small>
            </span>
          </Link>
          <Group title="Overview">
            <Item to="/" icon="home" label="Home" here={here} />
            <Item to="/attention" icon="attention" label="Needs attention" count={needs.total} warn here={here} />
            <Item to="/spend" icon="spend" label="Spend" here={here} />
          </Group>
          <Group title="Product">{PRODUCT.map(kindItem)}</Group>
          <Group title="Work">
            {kindItem("change")}
            <Item to="/inbox" icon="inbox" label="Inbox" count={needs.inbox.length} warn here={here} />
            {kindItem("task")}
            {kindItem("release")}
          </Group>
          <Group title="Code">{CODE.map(kindItem)}</Group>
          <Group title="Runs">{RUNS.map(kindItem)}</Group>
          {pictures.length > 0 ? (
            <Group title="Pictures">
              {pictures.map((place) => (
                <Item key={place.slug} to={place.address} icon="picture" label={place.title} here={here} />
              ))}
            </Group>
          ) : null}
          <Group title="Everything else">
            {kinds.filter((k) => !named.has(k)).map(kindItem)}
            <Item to="/problems" icon="constraint" label="Problems" here={here} />
          </Group>
          <SyncStatusLine off="start with ndx graview serve . for two-way sync" />
        </aside>
        <main className="ndx-main" ref={main} id="main">
          {children}
        </main>
      </div>
    );
  };
}
