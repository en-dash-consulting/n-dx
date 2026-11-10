/**
 * The lens packet: the bounded, deterministic context a Sidecar lens opens a
 * turn with.
 *
 * A packet is built by code, never by a model. It is capped in characters,
 * every section carries where it came from, when that was and whether it may
 * be out of date, and a section cut to fit the cap says so in the packet
 * itself: the model must not mistake a trimmed list for the whole list.
 *
 * {@link assemblePacket} is pure. It never reads the clock or the disk, so the
 * same sections always render the same text and a snapshot test can pin it.
 *
 * Design: local-design-workshop/docs/analysis/sidecar/README.md §3.
 */

/** Where a section's facts were read and when that read reflects. */
export interface Provenance {
  /** The file, command or store the facts came from. */
  source: string;
  /** ISO 8601: when the source was written, or read when it carries no stamp of its own. */
  generatedAt: string;
}

export type Staleness =
  | { state: "fresh" }
  /** The source says it is behind what it describes. */
  | { state: "stale"; reason: string }
  /** The source carries nothing to judge it by. */
  | { state: "unknown"; reason: string };

export interface PacketSection {
  /** Stable key; names the section in the cut notice. */
  id: string;
  title: string;
  /** Plain text lines. A section is trimmed at a line boundary. */
  body: string;
  provenance: Provenance;
  staleness: Staleness;
}

export interface PacketCut {
  section: string;
  kind: "trimmed" | "dropped";
  /** Characters of the section's body that did not fit. */
  droppedChars: number;
}

export interface Packet {
  lens: string;
  cap: number;
  /** `text.length`; never above `cap`. */
  chars: number;
  text: string;
  /** The sections that made it in, after trimming. */
  sections: PacketSection[];
  /** What was cut to fit; empty when everything fit. */
  cut: PacketCut[];
}

/** A trimmed section keeps at least this many characters of body, or is dropped whole. */
const MIN_KEPT_BODY = 120;

function stalenessText(s: Staleness): string {
  return s.state === "fresh" ? "fresh" : `${s.state}: ${s.reason}`;
}

function sectionText(section: PacketSection, body: string): string {
  const meta = `_source: ${section.provenance.source} · generated: ${section.provenance.generatedAt} · ${stalenessText(section.staleness)}_`;
  return `## ${section.title}\n${meta}\n\n${body}`;
}

function cutNotice(cuts: PacketCut[]): string {
  if (cuts.length === 0) return "";
  const lines = cuts.map((c) =>
    c.kind === "dropped"
      ? `- ${c.section}: left out whole (${c.droppedChars} chars)`
      : `- ${c.section}: trimmed, ${c.droppedChars} chars cut from the end`,
  );
  return `## Cut to fit\nThe packet cap is reached. What follows is not the whole picture:\n${lines.join("\n")}`;
}

interface Kept {
  section: PacketSection;
  body: string;
}

function render(header: string, kept: Kept[], cuts: PacketCut[]): string {
  const parts = [header, ...kept.map((k) => sectionText(k.section, k.body))];
  const notice = cutNotice(cuts);
  if (notice) parts.push(notice);
  return parts.join("\n\n");
}

/** `body` cut back to the last line break at or before `max` characters. */
function trimToLines(body: string, max: number): string {
  if (max <= 0) return "";
  if (body.length <= max) return body;
  const at = body.lastIndexOf("\n", max);
  return at > 0 ? body.slice(0, at) : "";
}

function recordCut(cuts: PacketCut[], section: string, kind: PacketCut["kind"], droppedChars: number): void {
  const existing = cuts.find((c) => c.section === section);
  if (existing) {
    existing.droppedChars += droppedChars;
    existing.kind = kind;
  } else {
    cuts.push({ section, kind, droppedChars });
  }
}

/**
 * Render `sections` under a header, in order, within `cap` characters.
 *
 * When the result is too long the last section is trimmed first, a line at a
 * time, and dropped once less than {@link MIN_KEPT_BODY} characters of it
 * would remain; then the one before it, and so on. So the order of `sections`
 * is the order of importance. The "Cut to fit" notice is counted against the
 * cap, so the packet that names its cuts still fits.
 */
export function assemblePacket(input: { lens: string; cap: number; header: string; sections: PacketSection[] }): Packet {
  const { lens, cap, header } = input;
  const kept: Kept[] = input.sections.map((section) => ({ section, body: section.body }));
  const cuts: PacketCut[] = [];
  let text = render(header, kept, cuts);

  while (text.length > cap && kept.length > 0) {
    const last = kept[kept.length - 1]!;
    const over = text.length - cap;
    // The notice grows by about a line for a first cut of this section.
    const slack = 120;
    const want = last.body.length - over - slack;
    const trimmed = want >= MIN_KEPT_BODY ? trimToLines(last.body, want) : "";
    if (trimmed.length >= MIN_KEPT_BODY) {
      recordCut(cuts, last.section.id, "trimmed", last.body.length - trimmed.length);
      last.body = trimmed;
    } else {
      recordCut(cuts, last.section.id, "dropped", last.body.length);
      kept.pop();
    }
    text = render(header, kept, cuts);
  }

  // Header and notice alone can pass a very small cap; the cap still wins.
  if (text.length > cap) text = text.slice(0, cap);

  return {
    lens,
    cap,
    chars: text.length,
    text,
    sections: kept.map((k) => ({ ...k.section, body: k.body })),
    cut: cuts,
  };
}
