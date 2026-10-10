/**
 * THE KIT: the few parts every screen is made of. Each takes the page
 * context where it needs the store, and nothing here knows a kind by name
 * except the icon table, which is the one place a kind's picture lives.
 */
import type { AnySchema } from "@graview/core";
import { recordPath, type PageContext } from "@graview/pages";
import type { CSSProperties, ReactNode } from "react";
import { Link } from "react-router-dom";
import { current, glance, label, said, tokens, toneOfStatus, when, type Node, type Tone } from "../model/graph.js";

export type Ctx = PageContext<AnySchema>;

export const at = (i: number, extra?: CSSProperties): CSSProperties => ({ ["--i" as string]: Math.min(i, 16), ...extra });

const ICONS: Record<string, string> = {
  area: "M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z M9 4v14 M15 6v14",
  capability: "M21 8l-9-5-9 5v8l9 5 9-5z M3 8l9 5 9-5 M12 13v8",
  constraint: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z M9 12l2 2 4-4",
  change: "M20 7H7 M10 4L7 7l3 3 M4 17h13 M14 20l3-3-3-3",
  task: "M9 12l2 2 4-4 M5 4h14a1 1 0 011 1v14a1 1 0 01-1 1H5a1 1 0 01-1-1V5a1 1 0 011-1z",
  release: "M20 12l-8 8-9-9V4h7l10 8z M7.5 7.5h.01",
  zone: "M12 2l8.5 5v10L12 22l-8.5-5V7z",
  component: "M4 8h4a2 2 0 104 0h4v4a2 2 0 100 4v4H4z",
  file: "M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V9z M14 3v6h6",
  run: "M12 22a10 10 0 100-20 10 10 0 000 20z M10 8l6 4-6 4z",
  commit: "M12 16a4 4 0 100-8 4 4 0 000 8z M2 12h6 M16 12h6",
  spend: "M12 2a9 3 0 100 6 9 3 0 000-6z M3 5v4c0 1.7 4 3 9 3s9-1.3 9-3V5 M3 9v4c0 1.7 4 3 9 3s9-1.3 9-3V9 M3 13v4c0 1.7 4 3 9 3s9-1.3 9-3v-4",
  attention: "M6 8a6 6 0 1112 0c0 7 3 9 3 9H3s3-2 3-9 M10 21h4",
  picture: "M4 5h16v14H4z M4 15l5-5 4 4 3-3 4 4 M15 9h.01",
  home: "M3 11l9-8 9 8v10H3z M9 21v-6h6v6",
  inbox: "M4 13h5l1 2h4l1-2h5 M4 13V7l2-3h12l2 3v6 M4 13v6h16v-6",
  scene: "M12 2l9 5v10l-9 5-9-5V7z M3 7l9 5 9-5 M12 12v10",
  search: "M11 19a8 8 0 100-16 8 8 0 000 16z M21 21l-4.3-4.3",
  moon: "M21 13A9 9 0 1111 3a7 7 0 0010 10z",
  sun: "M12 17a5 5 0 100-10 5 5 0 000 10z M12 2v2 M12 20v2 M4.9 4.9l1.4 1.4 M17.7 17.7l1.4 1.4 M2 12h2 M20 12h2 M4.9 19.1l1.4-1.4 M17.7 6.3l1.4-1.4",
  records: "M4 6h16 M4 12h16 M4 18h10",
};

export function Icon({ name, className, style }: { name: string; className?: string; style?: CSSProperties }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className} style={style}>
      <path d={ICONS[name] ?? ICONS.records!} />
    </svg>
  );
}

/** A kind's icon in the kind's own hue (the declaration's `brand.accents`). */
export function KindIcon({ context, kind, className }: { context: Ctx; kind: string; className?: string }) {
  const hue = (context.brand?.accents as Record<string, number> | undefined)?.[kind];
  return <Icon name={kind} className={`ndx-kind ${className ?? ""}`} style={hue === undefined ? undefined : ({ ["--hue" as string]: hue } as CSSProperties)} />;
}

export function Page({ children, narrow, testId }: { children: ReactNode; narrow?: boolean; testId?: string }) {
  return (
    <div className={`ndx-page${narrow ? " narrow" : ""}`} data-testid={testId}>
      {children}
    </div>
  );
}

export function Hero({ eyebrow, title, lede, children }: { eyebrow?: ReactNode; title: ReactNode; lede?: ReactNode; children?: ReactNode }) {
  return (
    <header className="ndx-hero ndx-rise">
      {eyebrow ? <p className="ndx-eyebrow">{eyebrow}</p> : null}
      <h1 className="ndx-h1">{title}</h1>
      {lede ? <p className="ndx-lede">{lede}</p> : null}
      {children ? <div className="ndx-hero-row">{children}</div> : null}
    </header>
  );
}

export function Stats({ children }: { children: ReactNode }) {
  return <div className="ndx-stats">{children}</div>;
}

export function Stat({ label, value, tone, hint, i = 0 }: { label: ReactNode; value: ReactNode; tone?: Tone; hint?: ReactNode; i?: number }) {
  return (
    <div className={`ndx-stat ndx-rise ${tone ?? ""}`} style={at(i)}>
      <b>{value}</b>
      <span>{label}</span>
      {hint ? <small>{hint}</small> : null}
    </div>
  );
}

export function Section({ title, more, children, i = 0, testId }: { title: ReactNode; more?: { to: string; label: string }; children: ReactNode; i?: number; testId?: string }) {
  return (
    <section className="ndx-section ndx-rise" style={at(i)} data-testid={testId}>
      <header>
        <h2 className="ndx-h2">{title}</h2>
        {more ? (
          <Link to={more.to} className="ndx-more">
            {more.label} →
          </Link>
        ) : null}
      </header>
      {children}
    </section>
  );
}

export function Badge({ tone, children, plain }: { tone?: Tone; children: ReactNode; plain?: boolean }) {
  return <span className={`ndx-badge ${tone ?? ""}${plain ? " plain" : ""}`}>{children}</span>;
}

export function StatusBadge({ status }: { status: unknown }) {
  if (status === undefined || status === null || status === "") return null;
  return <Badge tone={toneOfStatus(status)}>{said(status)}</Badge>;
}

export function Meter({ value, max = 1, label, tone, text }: { value: number; max?: number; label: ReactNode; tone?: Tone; text?: string }) {
  const share = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  return (
    <div className={`ndx-meter ${tone ?? ""}`} role="meter" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} aria-label={typeof label === "string" ? label : undefined}>
      <span>
        {label}
        <b>{text ?? `${Math.round(share * 100)}%`}</b>
      </span>
      <i>
        <b style={{ ["--w" as string]: `${share * 100}%` } as CSSProperties} />
      </i>
    </div>
  );
}

/** An empty state that names the n-dx command that fills it. */
export function Empty({ children, command }: { children: ReactNode; command?: string }) {
  return (
    <div className="ndx-empty">
      <p>{children}</p>
      {command ? (
        <p>
          <code>{command}</code>
        </p>
      ) : null}
    </div>
  );
}

export function Grid({ children }: { children: ReactNode }) {
  return <div className="ndx-grid">{children}</div>;
}

export function Rows({ children }: { children: ReactNode }) {
  return <div className="ndx-rows">{children}</div>;
}

/** One record as a row: its kind's icon, its label, a glance, its status. */
export function RecordRow({ context, node, i = 0, sub, end, depth = 0 }: { context: Ctx; node: Node; i?: number; sub?: ReactNode; end?: ReactNode; depth?: number }) {
  const { store } = context;
  const seen = glance(store, node, 3)
    .filter((f) => f.key !== "status" && f.value !== "No" && f.value !== "Yes")
    .slice(0, 2)
    .map((f) => ({ ...f, value: /^\d{4}-\d{2}-\d{2}T/.test(f.value) ? when(f.value) : /^\d{5,}$/.test(f.value) ? tokens(Number(f.value)) : f.value }));
  return (
    <Link
      to={recordPath(store.schema, node.kind, node.id)}
      className={`ndx-row ndx-rise${current(store, node) ? "" : " past"}${depth ? ` ndx-depth-${Math.min(depth, 3)}` : ""}`}
      style={at(i)}
    >
      <KindIcon context={context} kind={node.kind} />
      <span style={{ minWidth: 0, display: "grid" }}>
        <span className="ndx-title">{label(store, node)}</span>
        <span className="ndx-sub">{sub ?? seen.map((f) => `${f.label}: ${f.value}`).join(" · ")}</span>
      </span>
      <span className="ndx-row-end">{end ?? <StatusBadge status={node.status} />}</span>
    </Link>
  );
}

/** One record as a card: for the home's areas and a kind's list. */
export function RecordCard({ context, node, i = 0, children }: { context: Ctx; node: Node; i?: number; children?: ReactNode }) {
  const { store } = context;
  const seen = glance(store, node, 3);
  const tone = node.health === "defective" || node.status === "blocked" || node.status === "failing" ? " bad" : "";
  return (
    <Link to={recordPath(store.schema, node.kind, node.id)} className={`ndx-card ndx-rise${tone}`} style={at(i)}>
      <span className="ndx-kindline">
        <KindIcon context={context} kind={node.kind} />
        {store.schema.tryDefinition(node.kind)?.noun ?? node.kind}
      </span>
      <h3>{label(store, node)}</h3>
      {children ?? (
        <div className="ndx-badges">
          {seen.map((f) => (
            <Badge key={f.key} tone={f.key === "status" || f.key === "intentStatus" || f.key === "health" ? toneOfStatus(node[f.key]) : undefined} plain={!(f.key === "status" || f.key === "intentStatus" || f.key === "health")}>
              {f.key === "status" || f.key === "intentStatus" || f.key === "health" ? said(node[f.key]) : `${f.label} ${f.value}`}
            </Badge>
          ))}
        </div>
      )}
    </Link>
  );
}

export function Facts({ fields }: { fields: readonly { key: string; label: string; value: string; long?: boolean }[] }) {
  if (fields.length === 0) return null;
  return (
    <dl className="ndx-dl">
      {fields.map((f) => (
        <div key={f.key} style={{ display: "contents" }}>
          <dt>{f.label}</dt>
          <dd className={f.long ? "ndx-prose" : undefined}>{/^\d{4}-\d{2}-\d{2}T/.test(f.value) ? `${when(f.value)} (${f.value.slice(0, 10)})` : f.value}</dd>
        </div>
      ))}
    </dl>
  );
}
