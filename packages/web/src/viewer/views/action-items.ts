/**
 * What to do, as the Analyze dashboard lists it: the Codebase health tile's
 * next steps, problems and suggestions, and the Infrastructure & architecture
 * tile's readiness gaps and architecture findings. One item model, one list
 * component, two builders.
 *
 * Health: next steps come from `/api/sv/next-steps`, which derives them from
 * the same zone findings the Problems and Suggestions views read, and each
 * step names the findings it groups (`relatedFindings`). A finding a listed
 * step already covers is not listed again. Problems, Suggestions and
 * Architecture keep their views' enrichment gates: below the pass a view
 * needs, the list says which pass unlocks them.
 *
 * Every item is tagged with what it concerns (cohesion, coupling, readiness,
 * boundaries) and the zones it touches — its scope, and the zones and files
 * its text names. A tile's stat cards highlight the items a concern tags while
 * hovered and filter the list to them when pressed (`useConcernFocus`).
 * Hovering an item lights its zones on the codebase map; an item whose remedy
 * adds files the map cannot draw yet carries a `note` the map shows beside it
 * (analyze-actions-context.ts).
 *
 * Any item can be added to the PRD — "+ PRD" on its row, or every item shown
 * at once from the opened tile — through POST /api/rex/capture-recommendations:
 * one Inbox change each on v2, skipping any the PRD already holds.
 */

import { h } from "preact";
import type { ComponentChild } from "preact";
import { useCallback, useState } from "preact/hooks";
import type { LoadedData } from "../types.js";
import type { Finding } from "../external.js";
import { zoneConcerns, zoneNeedsAttention } from "../visualization/index.js";
import { ENRICHMENT_THRESHOLDS } from "./enrichment-thresholds.js";
import { effectiveEnrichmentPass } from "../enrichment-pass.js";
import { dimensionRows, scoreBand, type Readiness } from "./delivery.js";
import { copyText, stepsToMarkdown, type NextStep } from "./next-steps.js";

// ── The item model ─────────────────────────────────────────────

/** What a stat card can highlight and filter by. */
export type ActionConcern = "cohesion" | "coupling" | "readiness" | "boundaries";
export type ActionKind = "step" | "problem" | "suggestion" | "gap" | "relationship" | "pattern" | "move";

export interface ActionItem {
  key: string;
  kind: ActionKind;
  /** A step's priority (high/medium/low), a finding's severity (critical/warning/info). */
  level: string;
  title: string;
  /** A step's description, a gap's remedy; a finding's text is its title. */
  detail?: string;
  /** What the item concerns: the stat cards that light it. */
  concerns: readonly ActionConcern[];
  /** Zones the item touches, lit on the codebase map while it is hovered. */
  zones: readonly string[];
  /** Shown beside the map: what acting on it adds that the map cannot draw yet. */
  note?: string;
}

export interface ActionList {
  items: ActionItem[];
  /** Parts still behind an enrichment pass, named, with the pass each needs. */
  gated: Array<{ label: string; pass: number }>;
  /** The listed next steps, for copy and capture. Empty outside the health tile. */
  steps: readonly NextStep[];
}

const KIND_LABEL: Record<ActionKind, string> = {
  step: "Next step",
  problem: "Problem",
  suggestion: "Suggestion",
  gap: "Readiness",
  relationship: "Boundary",
  pattern: "Pattern",
  move: "Move file",
};

const KIND_PLURAL: Record<ActionKind, string> = {
  step: "next steps",
  problem: "problems",
  suggestion: "suggestions",
  gap: "readiness gaps",
  relationship: "boundary findings",
  pattern: "patterns",
  move: "files to move",
};

const CONCERN_LABEL: Record<ActionConcern, string> = {
  cohesion: "Cohesion",
  coupling: "Coupling",
  readiness: "Readiness",
  boundaries: "Boundary",
};

const SEVERITY_ORDER: Record<string, number> = { critical: 0, warning: 1, info: 2 };

/** Words that name a concern in an item's text. */
const CONCERN_TEXT: Record<"cohesion" | "coupling" | "boundaries", RegExp> = {
  cohesion: /cohesi|loosely related/i,
  coupling: /coupl|bidirectional|cross-zone/i,
  boundaries: /cross-zone|bidirectional|coupl|boundar|layer/i,
};

/** Advice whose remedy creates files or directories: extracting, splitting, a new module. */
const NEW_FILES =
  /\bextract|\bsplit|\bdecompos|new (?:module|file|directory|package|folder)|dedicated (?:directory|module)|consolidat|subdirector/i;

export const NEW_FILES_NOTE = "Acting on this adds files or directories that are not on the map yet.";

/** A repository-relative file path in an item's text. */
const PATH_IN_TEXT = /[\w@.-]+(?:\/[\w@.-]+)+\.[A-Za-z0-9]+/g;

type ZoneMetrics = { id: string; cohesion: number; coupling: number };

interface ZoneIndex {
  byId: ReadonlyMap<string, ZoneMetrics>;
  byFile: ReadonlyMap<string, string>;
  /** How each zone is recognised by name: quoted, or bare when hyphenated enough not to be a plain word. */
  named: ReadonlyArray<{ id: string; pattern: RegExp }>;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function zoneIndex(data: LoadedData): ZoneIndex {
  const zones = data.zones?.zones ?? [];
  const byFile = new Map<string, string>();
  for (const z of zones) for (const f of z.files) byFile.set(f, z.id);
  return {
    byId: new Map(zones.map((z) => [z.id, z])),
    byFile,
    named: zones.map((z) => ({
      id: z.id,
      pattern: z.id.includes("-")
        ? new RegExp(`(^|[^\\w-])${escapeRegExp(z.id)}($|[^\\w-])`)
        : new RegExp(`"${escapeRegExp(z.id)}"`),
    })),
  };
}

/** The zones an item touches: its scope, the zones it names, and the zones of the files it names. */
function zonesOf(text: string, scope: string | undefined, index: ZoneIndex): string[] {
  const found = new Set<string>();
  if (scope && scope !== "global" && index.byId.has(scope)) found.add(scope);
  for (const { id, pattern } of index.named) if (pattern.test(text)) found.add(id);
  for (const path of text.match(PATH_IN_TEXT) ?? []) {
    const zone = index.byFile.get(path);
    if (zone) found.add(zone);
  }
  return [...found];
}

/** Cohesion and coupling from the text and each touched zone's metrics. */
function metricConcerns(text: string, zones: readonly string[], index: ZoneIndex): ActionConcern[] {
  const flagged = new Set(zones.flatMap((id) => {
    const z = index.byId.get(id);
    return z ? zoneConcerns(z) : [];
  }));
  return (["cohesion", "coupling"] as const).filter((c) => CONCERN_TEXT[c].test(text) || flagged.has(c));
}

function newFilesNote(text: string): string | undefined {
  return NEW_FILES.test(text) ? NEW_FILES_NOTE : undefined;
}

function indexed(findings: readonly Finding[], keep: (f: Finding) => boolean): Array<{ f: Finding; i: number }> {
  return findings
    .map((f, i) => ({ f, i }))
    .filter(({ f }) => keep(f))
    .sort((a, b) => (SEVERITY_ORDER[a.f.severity ?? "info"] ?? 2) - (SEVERITY_ORDER[b.f.severity ?? "info"] ?? 2));
}

/**
 * The Codebase health list: next steps, then the problems and suggestions no
 * listed step covers, each kind most severe first. Tagged with cohesion and
 * coupling, the two metrics its stat cards show.
 */
export function buildHealthActions(data: LoadedData, steps: readonly NextStep[] | null): ActionList {
  const findings: readonly Finding[] = data.zones?.findings ?? [];
  const index = zoneIndex(data);
  const pass = effectiveEnrichmentPass(data.zones, data.manifest);
  const listedSteps = steps ?? [];
  const covered = new Set(listedSteps.flatMap((s) => s.relatedFindings ?? []));

  const items: ActionItem[] = listedSteps.map((s, i) => {
    const text = `${s.title} ${s.description}`;
    const zones = zonesOf(text, s.scope, index);
    return {
      key: `step-${i}`,
      kind: "step",
      level: s.priority,
      title: s.title,
      detail: s.description,
      concerns: metricConcerns(text, zones, index),
      zones,
      note: newFilesNote(text),
    };
  });

  const gated: ActionList["gated"] = [];
  const findingsOf = (kind: "problem" | "suggestion", type: Finding["type"], needs: number) => {
    if (pass < needs) {
      gated.push({ label: KIND_PLURAL[kind], pass: needs });
      return;
    }
    for (const { f, i } of indexed(findings, (x) => x.type === type)) {
      if (covered.has(i)) continue;
      const zones = zonesOf(f.text, f.scope, index);
      items.push({
        key: `${kind}-${i}`,
        kind,
        level: f.severity ?? "info",
        title: f.text,
        concerns: metricConcerns(f.text, zones, index),
        zones,
        note: newFilesNote(f.text),
      });
    }
  };
  findingsOf("problem", "anti-pattern", ENRICHMENT_THRESHOLDS.problems);
  findingsOf("suggestion", "suggestion", ENRICHMENT_THRESHOLDS.suggestions);

  return { items, gated, steps: listedSteps };
}

/** A readiness band as a priority, so gaps sort and colour like next steps. */
const BAND_LEVEL = { poor: "high", fair: "medium", good: "low" } as const;

/**
 * The Infrastructure & architecture list: readiness gaps, weakest practice
 * first — none is on the map, so each carries its remedy as the map's note —
 * then the architecture findings (relationships and patterns, behind
 * Architecture's enrichment gate) and the files the analysis would move to
 * another zone. Relationships, moves and any finding about crossings or
 * coupling concern boundaries.
 */
export function buildInfraActions(data: LoadedData, readiness: Readiness | null): ActionList {
  const findings: readonly Finding[] = data.zones?.findings ?? [];
  const index = zoneIndex(data);
  const pass = effectiveEnrichmentPass(data.zones, data.manifest);
  const items: ActionItem[] = [];

  if (readiness) {
    for (const r of dimensionRows(readiness).sort((a, b) => a.score - b.score)) {
      r.gaps.forEach((g, i) => items.push({
        key: `gap-${r.id}-${i}`,
        kind: "gap",
        level: BAND_LEVEL[scoreBand(r.score)],
        title: `${r.label}: ${g.summary}`,
        detail: g.wouldRaiseScore,
        concerns: ["readiness"],
        zones: [],
        note: `Not on the map — closing it adds files: ${g.wouldRaiseScore}`,
      }));
    }
  }

  const findingItem = (kind: ActionKind, f: Finding, i: number): ActionItem => {
    const zones = zonesOf(f.text, f.scope, index);
    const boundary = kind !== "pattern" || CONCERN_TEXT.boundaries.test(f.text);
    return {
      key: `${kind}-${i}`,
      kind,
      level: f.severity ?? "info",
      title: f.text,
      concerns: boundary ? ["boundaries"] : [],
      zones,
      note: newFilesNote(f.text),
    };
  };
  const gated: ActionList["gated"] = [];
  if (pass < ENRICHMENT_THRESHOLDS.architecture) {
    gated.push({ label: "architecture findings", pass: ENRICHMENT_THRESHOLDS.architecture });
  } else {
    for (const { f, i } of indexed(findings, (x) => x.type === "relationship" || x.type === "pattern")) {
      items.push(findingItem(f.type === "relationship" ? "relationship" : "pattern", f, i));
    }
  }
  for (const { f, i } of indexed(findings, (x) => x.type === "move-file")) items.push(findingItem("move", f, i));

  return { items, gated, steps: [] };
}

/** A "!" on the map: "crit" for critical or high, "warn" for warning or medium. */
export type ZoneMark = "warn" | "crit";

/**
 * The zones the map marks: every zone a listed item touches at warning or
 * above, and every zone the health views flag for cohesion or coupling.
 */
export function zoneIssues(data: LoadedData, items: readonly ActionItem[]): Record<string, ZoneMark> {
  const marks: Record<string, ZoneMark> = {};
  const mark = (id: string, m: ZoneMark) => { if (marks[id] !== "crit") marks[id] = m; };
  for (const z of data.zones?.zones ?? []) if (zoneNeedsAttention(z)) mark(z.id, "warn");
  for (const item of items) {
    const m: ZoneMark | null = item.level === "critical" || item.level === "high" ? "crit"
      : item.level === "warning" || item.level === "medium" ? "warn"
      : null;
    if (m) for (const id of item.zones) mark(id, m);
  }
  return marks;
}

/** How many items each concern tags — shown on the stat cards. */
export function concernCounts(items: readonly ActionItem[], concerns: readonly ActionConcern[]): Record<string, number> {
  return Object.fromEntries(concerns.map((c) => [c, items.filter((a) => a.concerns.includes(c)).length]));
}

// ── Focus: the stat cards over a list ──────────────────────────

/** The concern hovered over (highlights) and the one pressed (filters). */
export interface ConcernFocus {
  hover: ActionConcern | null;
  filter: ActionConcern | null;
  setHover: (concern: ActionConcern | null) => void;
  /** Press a concern: filter to it, or clear the filter if it is the one applied. */
  toggle: (concern: ActionConcern) => void;
  clear: () => void;
}

export function useConcernFocus(): ConcernFocus {
  const [hover, setHover] = useState<ActionConcern | null>(null);
  const [filter, setFilter] = useState<ActionConcern | null>(null);
  const toggle = useCallback((concern: ActionConcern) => setFilter((f) => (f === concern ? null : concern)), []);
  const clear = useCallback(() => setFilter(null), []);
  return { hover, filter, setHover, toggle, clear };
}

/** What a stat card takes to drive a list's focus: press filters, hover highlights. */
export interface ConcernCardProps {
  onOpen: () => void;
  pressed: boolean;
  onHover: (over: boolean) => void;
  action: string;
  hint: string;
}

export function concernCardProps(focus: ConcernFocus, counts: Record<string, number>, concern: ActionConcern): ConcernCardProps {
  const n = counts[concern] ?? 0;
  const items = `${n} item${n === 1 ? "" : "s"}`;
  return {
    onOpen: () => focus.toggle(concern),
    pressed: focus.filter === concern,
    onHover: (over: boolean) => focus.setHover(over ? concern : null),
    action: `show the ${items} it concerns`,
    hint: `${items} below concern ${CONCERN_LABEL[concern].toLowerCase()}: hover to highlight, click to filter`,
  };
}

// ── Adding recommendations to the PRD ──────────────────────────

/** The endpoint that adds recommendations: an Inbox change each on v2. */
export const CAPTURE_RECOMMENDATIONS_ENDPOINT = "/api/rex/capture-recommendations";

/** Where an item stands: being added, added now, already in the PRD, or refused. */
export type CaptureState = "pending" | "created" | "exists" | "error";

export interface RecommendationCapture {
  /** Item key → where it stands; absent until it is added. */
  state: Readonly<Record<string, CaptureState>>;
  /** The last add's outcome, in words. */
  message: { ok: boolean; text: string } | null;
  add: (items: readonly ActionItem[]) => Promise<void>;
}

/** What the server is sent for an item; a gap's remedy is its acceptance criterion. */
export function recommendationPayload(item: ActionItem) {
  return {
    title: item.title,
    ...(item.detail ? { detail: item.detail } : {}),
    kind: item.kind,
    level: item.level,
    zones: [...item.zones],
    ...(item.note ? { note: item.note } : {}),
    ...(item.kind === "gap" && item.detail ? { acceptanceCriteria: [item.detail] } : {}),
  };
}

interface CaptureResponse {
  created?: number;
  skipped?: number;
  destination?: string;
  results?: Array<"created" | "exists">;
  error?: string;
}

/**
 * Adds recommendations to the PRD through {@link CAPTURE_RECOMMENDATIONS_ENDPOINT}
 * and remembers, per item, what happened — so an item added from the tile reads
 * as added in the opened tile too, and a second press is not a second request.
 */
export function useRecommendationCapture(): RecommendationCapture {
  const [state, setState] = useState<Record<string, CaptureState>>({});
  const [message, setMessage] = useState<RecommendationCapture["message"]>(null);

  const add = useCallback(async (items: readonly ActionItem[]) => {
    if (items.length === 0) return;
    const mark = (to: (i: number) => CaptureState) =>
      setState((prev) => ({ ...prev, ...Object.fromEntries(items.map((it, i) => [it.key, to(i)])) }));
    mark(() => "pending");
    setMessage(null);
    try {
      const res = await fetch(CAPTURE_RECOMMENDATIONS_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: items.map(recommendationPayload) }),
      });
      const body = await res.json().catch(() => ({})) as CaptureResponse;
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      const results = body.results ?? [];
      mark((i) => results[i] ?? "created");
      const created = body.created ?? 0;
      const skipped = body.skipped ?? 0;
      const where = body.destination === "Inbox" ? "the Inbox" : `"${body.destination ?? "the PRD"}"`;
      setMessage({
        ok: true,
        text: created > 0
          ? `✓ Added ${created} to ${where}` + (skipped > 0 ? ` (${skipped} already in the PRD)` : "")
          : `Already in the PRD${items.length > 1 ? ` — all ${items.length}` : ""}`,
      });
    } catch (err) {
      mark(() => "error");
      setMessage({ ok: false, text: err instanceof Error ? err.message : String(err) });
    }
  }, []);

  return { state, message, add };
}

const CAPTURE_LABEL: Record<CaptureState, string> = {
  pending: "Adding…",
  created: "✓ Added",
  exists: "✓ In PRD",
  error: "Retry",
};

/** An item's "+ PRD" control: adds it, then says where it stands. */
function AddToPrd({ item, capture }: { item: ActionItem; capture: RecommendationCapture }): ComponentChild {
  const state = capture.state[item.key];
  const done = state === "created" || state === "exists";
  return h("button", {
    type: "button",
    class: `health-action-add${state ? ` health-action-add--${state}` : ""}`,
    disabled: state === "pending" || done,
    onClick: (e: Event) => { e.stopPropagation(); void capture.add([item]); },
    title: done
      ? (state === "created" ? "Added to the PRD" : "Already in the PRD")
      : "Add this recommendation to the PRD (the Inbox, on a v2 PRD)",
    "aria-label": done ? `${CAPTURE_LABEL[state]}: ${item.title}` : `Add to the PRD: ${item.title}`,
  }, state ? CAPTURE_LABEL[state] : "+ PRD");
}

/** "Add all to PRD" for the items shown, with a confirm step. */
function AddAllToPrd({ items, capture }: { items: readonly ActionItem[]; capture: RecommendationCapture }): ComponentChild {
  const [confirming, setConfirming] = useState(false);
  const open = items.filter((a) => {
    const s = capture.state[a.key];
    return s !== "created" && s !== "exists" && s !== "pending";
  });
  if (open.length === 0) return null;
  const n = `${open.length} recommendation${open.length === 1 ? "" : "s"}`;
  return confirming
    ? h("span", { class: "next-steps-confirm" },
        `Add ${n} to the PRD?`,
        h("button", {
          type: "button",
          class: "cmd-inline-trigger health-actions-add-confirm",
          onClick: () => { setConfirming(false); void capture.add(open); },
        }, "Confirm"),
        h("button", { type: "button", class: "cmd-inline-trigger", onClick: () => setConfirming(false) }, "Cancel"),
      )
    : h("button", {
        type: "button",
        class: "cmd-inline-trigger health-actions-add-all",
        onClick: () => setConfirming(true),
        title: "Add every recommendation shown to the PRD — the Inbox, on a v2 PRD; ones already there are skipped",
      }, `+ Add ${n} to PRD`);
}

// ── The list ───────────────────────────────────────────────────

interface ActionListProps {
  list: ActionList;
  focus: ConcernFocus;
  /** Unique per tile: the base of the heading's id. */
  idBase: string;
  /** In the opened tile: every item with its detail, plus copy and capture. */
  opened?: boolean;
  /** Items shown before "+N more" in the tile itself. */
  limit?: number;
  /** Links under the opened list ("All problems ↗"). */
  links?: ReadonlyArray<{ label: string; onClick: () => void }>;
  /** An item hovered, or null when the pointer leaves the list: lights its zones on the map. */
  onItemHover?: (item: ActionItem | null) => void;
  /** Adds items to the PRD; absent where there is no server to add them (a static export). */
  capture?: RecommendationCapture | null;
}

/** "What to do": a tile's items, each tagged with its kind, under the tile's stats. */
export function ActionItemList({
  list, focus, idBase, opened = false, limit = 25, links = [], onItemHover, capture,
}: ActionListProps): ComponentChild {
  const [copied, setCopied] = useState(false);
  const { items, gated, steps } = list;
  const filtered = focus.filter ? items.filter((a) => a.concerns.includes(focus.filter!)) : items;
  const shown = opened ? filtered : filtered.slice(0, limit);
  const lit = focus.hover ?? null;
  const kinds = [...new Set(items.map((a) => a.kind))];
  const titleId = `${idBase}-title`;

  const copyAll = () => {
    copyText(stepsToMarkdown(steps)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => { /* no feedback on failure */ });
  };

  return h("section", {
    class: `health-actions${lit ? " health-actions--lit" : ""}`,
    "aria-labelledby": titleId,
    "data-lit": lit ?? undefined,
    onMouseLeave: onItemHover ? () => onItemHover(null) : undefined,
  },
    h("div", { class: "health-actions-head" },
      h("h3", { id: titleId }, "What to do", h("span", { class: "health-count" }, String(items.length))),
      h("span", { class: "health-actions-kinds" },
        kinds.map((kind) =>
          h("span", { key: kind, class: `health-kind health-kind--${kind}` },
            `${items.filter((a) => a.kind === kind).length} ${KIND_PLURAL[kind]}`)),
      ),
      focus.filter
        ? h("button", {
            type: "button",
            class: "health-actions-filter",
            onClick: focus.clear,
            "aria-label": `Showing ${CONCERN_LABEL[focus.filter].toLowerCase()} items only — show everything`,
          }, `${CONCERN_LABEL[focus.filter]} · ${filtered.length}`, h("span", { "aria-hidden": "true" }, " ×"))
        : null,
    ),
    items.length === 0 && gated.length === 0
      ? h("p", { class: "stage-tile-empty" }, "Nothing to act on.")
      : null,
    focus.filter && filtered.length === 0
      ? h("p", { class: "stage-tile-empty" }, `No item concerns ${CONCERN_LABEL[focus.filter].toLowerCase()}.`)
      : null,
    shown.length > 0
      ? h("ul", { class: "health-actions-list", role: "list" },
          shown.map((a) => {
            const isLit = lit !== null && a.concerns.includes(lit);
            return h("li", {
              key: a.key,
              class: `health-action health-action--${a.kind}${isLit ? " health-action--lit" : ""}`,
              "data-concerns": a.concerns.join(" ") || undefined,
              onMouseEnter: onItemHover ? () => onItemHover(a) : undefined,
            },
              h("div", { class: "health-action-row" },
                h("span", { class: `health-kind health-kind--${a.kind}` }, KIND_LABEL[a.kind]),
                h("span", { class: `health-level health-level--${a.level}`, title: a.level }, a.level),
                h("span", { class: "health-action-title" }, a.title),
                a.concerns.map((c) => h("span", { key: c, class: `health-concern health-concern--${c}` }, c)),
                a.note ? h("span", { class: "health-concern health-concern--new", title: a.note }, "new files") : null,
                capture ? h(AddToPrd, { item: a, capture }) : null,
              ),
              opened && a.detail && a.detail !== a.title
                ? h("p", { class: "health-action-detail" }, a.detail)
                : null,
            );
          }),
        )
      : null,
    !opened && filtered.length > shown.length
      ? h("p", { class: "health-meta" }, `+${filtered.length - shown.length} more`)
      : null,
    gated.length > 0
      ? h("p", { class: "health-meta health-actions-gated" },
          gated.map((g) => `${g.label[0]!.toUpperCase()}${g.label.slice(1)} need enrichment pass ${g.pass}`).join(" · "),
          " — run Full analysis to unlock them.")
      : null,
    capture?.message
      ? h("p", {
          class: `cmd-inline-result ${capture.message.ok ? "cmd-inline-result-ok" : "cmd-inline-result-err"} health-actions-captured`,
          role: capture.message.ok ? "status" : "alert",
        }, capture.message.text)
      : null,
    opened && (steps.length > 0 || links.length > 0 || capture)
      ? h("div", { class: "health-actions-foot" },
          capture ? h(AddAllToPrd, { items: filtered, capture }) : null,
          steps.length > 0
            ? h("button", {
                type: "button",
                class: "link-btn next-steps-copy-all",
                onClick: copyAll,
                title: "Copy the next steps as a markdown list",
              }, copied ? "✓ Copied" : "Copy next steps")
            : null,
          links.map((l) => h("button", { key: l.label, type: "button", class: "link-btn", onClick: l.onClick }, l.label)),
        )
      : null,
  );
}
