/**
 * THE DESIGN SYSTEM, ON GRAVIEW'S OWN TOKENS. Every color is mixed from the
 * theme the declared brand produced (`--graview-*`), so the palette is the one
 * `graview check` measured; every size is in rem, so the reader's text size
 * carries; every pressable thing clears 24px; motion stops under
 * prefers-reduced-motion.
 */
export const CSS = `
.ndx {
  --ndx-rail: 16.5rem;
  --ndx-max: 74rem;
  --ndx-kind-l: 48%;
  --ndx-tint: color-mix(in oklab, var(--graview-ground) 72%, var(--graview-panel) 28%);
  min-height: 100vh;
  display: grid;
  grid-template-columns: var(--ndx-rail) minmax(0, 1fr);
  background: var(--graview-ground);
  color: var(--graview-ink);
  font-family: var(--graview-font-body, system-ui, sans-serif);
  font-size: 1rem;
  line-height: 1.55;
  -webkit-font-smoothing: antialiased;
}
[data-graview-scheme="dark"] .ndx { --ndx-kind-l: 74%; }
.ndx a { color: inherit; text-decoration: none; }
.ndx :focus-visible { outline: 2px solid var(--graview-accent); outline-offset: 2px; border-radius: 0.35rem; }
.ndx button { font: inherit; color: inherit; }

/* ── The rail ─────────────────────────────────────────────────────────── */
.ndx-rail {
  position: sticky; top: 0; height: 100vh; overflow-y: auto; min-width: 0;
  padding: 1.25rem 0.9rem 1.5rem;
  border-right: 1px solid var(--graview-edge);
  background: var(--ndx-tint);
  display: grid; align-content: start; gap: 1.1rem;
  scrollbar-width: thin;
}
.ndx-brand { display: flex; align-items: center; gap: 0.7rem; padding: 0.25rem 0.5rem 0.5rem; }
.ndx-brand svg { width: 2rem; height: 2rem; flex: none; }
.ndx-brand b { display: block; font: 800 1.15rem/1.1 var(--graview-font-display, inherit); letter-spacing: -0.01em; }
.ndx-brand small { display: block; color: var(--graview-ink-muted); font-size: 0.74rem; margin-top: 0.1rem; }
.ndx-group { display: grid; gap: 0.1rem; }
.ndx-group h2 {
  margin: 0 0.6rem 0.35rem; font: 700 0.66rem/1 var(--graview-font-body, inherit);
  letter-spacing: 0.11em; text-transform: uppercase; color: var(--graview-ink-muted);
}
.ndx-nav { display: grid; gap: 0.1rem; }
.ndx-nav a {
  position: relative; display: flex; align-items: center; gap: 0.6rem; min-height: 2rem;
  padding: 0.4rem 0.6rem; border-radius: calc(var(--graview-radius, 10px) - 2px);
  color: var(--graview-ink-muted); font-weight: 500;
}
.ndx-nav a:hover { background: color-mix(in oklab, var(--graview-panel) 75%, transparent); color: var(--graview-ink); }
.ndx-nav a[aria-current="page"] {
  background: color-mix(in oklab, var(--graview-accent) 13%, var(--graview-panel));
  color: var(--graview-ink); font-weight: 600;
}
.ndx-nav a[aria-current="page"]::before {
  content: ""; position: absolute; left: -0.5rem; top: 0.5rem; bottom: 0.5rem; width: 3px;
  border-radius: 2px; background: var(--graview-accent);
}
.ndx-nav svg { width: 1.05rem; height: 1.05rem; flex: none; }
.ndx-count {
  margin-left: auto; font: 600 0.68rem/1 var(--graview-font-mono, monospace);
  padding: 0.22rem 0.45rem; border-radius: 999px;
  background: color-mix(in oklab, var(--graview-ink) 9%, transparent); color: var(--graview-ink);
}
.ndx-count.warn { background: color-mix(in oklab, var(--graview-warn) 26%, transparent); color: var(--graview-ink); }
.ndx-tools { display: flex; gap: 0.4rem; align-items: center; flex-wrap: wrap; padding: 0.2rem 0.4rem; }
.ndx-tools > * { min-width: 0; }

/* ── The page ─────────────────────────────────────────────────────────── */
.ndx-main { min-width: 0; padding: 2rem clamp(1rem, 4vw, 3rem) 5rem; }
.ndx-page { max-width: var(--ndx-max); margin: 0 auto; display: grid; gap: 1.75rem; }
.ndx-page.narrow { max-width: 54rem; }
.ndx-hero { display: grid; gap: 0.55rem; padding-bottom: 1.25rem; border-bottom: 1px solid var(--graview-edge); }
.ndx-eyebrow {
  margin: 0; display: flex; flex-wrap: wrap; gap: 0.35rem 0.6rem; align-items: center;
  font: 600 0.74rem/1.2 var(--graview-font-body, inherit); letter-spacing: 0.08em; text-transform: uppercase;
  color: var(--graview-ink-muted);
}
.ndx-eyebrow a:hover { color: var(--graview-ink); text-decoration: underline; }
.ndx-h1 {
  margin: 0; font: 800 clamp(1.55rem, 2.6vw, 2.25rem)/1.12 var(--graview-font-display, inherit);
  letter-spacing: -0.022em; text-wrap: balance; overflow-wrap: anywhere;
}
.ndx-lede { margin: 0; max-width: 64ch; color: var(--graview-ink-muted); font-size: 1.04rem; }
.ndx-hero-row { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; margin-top: 0.35rem; }

.ndx-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(9.5rem, 1fr)); gap: 0.75rem; }
.ndx-stat {
  position: relative; padding: 0.95rem 1.05rem 0.9rem; display: grid; gap: 0.2rem; align-content: start;
  border: 1px solid var(--graview-edge); border-radius: var(--graview-radius, 10px); background: var(--graview-panel);
  overflow: hidden;
}
.ndx-stat::before { content: ""; position: absolute; left: 0; top: 0.9rem; bottom: 0.9rem; width: 3px; border-radius: 2px; background: var(--graview-edge); }
.ndx-stat.good::before { background: var(--graview-good); }
.ndx-stat.bad::before { background: var(--graview-bad); }
.ndx-stat.warn::before { background: var(--graview-warn); }
.ndx-stat.accent::before { background: var(--graview-accent); }
.ndx-stat b { font: 700 1.85rem/1 var(--graview-font-display, inherit); letter-spacing: -0.025em; font-variant-numeric: tabular-nums; }
.ndx-stat span { font-size: 0.8rem; color: var(--graview-ink-muted); }
.ndx-stat small { font-size: 0.74rem; color: var(--graview-ink-muted); }

.ndx-section { display: grid; gap: 0.7rem; }
.ndx-section > header { display: flex; align-items: baseline; justify-content: space-between; gap: 1rem; flex-wrap: wrap; }
.ndx-h2 { margin: 0; font: 700 1.05rem/1.3 var(--graview-font-display, inherit); letter-spacing: -0.01em; }
.ndx-h3 { margin: 0; font: 650 0.95rem/1.3 var(--graview-font-body, inherit); }
.ndx-more { font-size: 0.84rem; color: var(--graview-accent); font-weight: 600; }
.ndx-more:hover { text-decoration: underline; }
.ndx-two { display: grid; gap: 1.5rem; grid-template-columns: repeat(auto-fit, minmax(20rem, 1fr)); align-items: start; }
.ndx-grid { display: grid; gap: 0.75rem; grid-template-columns: repeat(auto-fill, minmax(15.5rem, 1fr)); }

.ndx-card {
  padding: 0.95rem 1.05rem; display: grid; gap: 0.5rem; align-content: start; min-width: 0;
  border: 1px solid var(--graview-edge); border-radius: var(--graview-radius, 10px); background: var(--graview-panel);
  transition: transform 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease;
}
.ndx-card h3 { margin: 0; font: 650 0.98rem/1.3 var(--graview-font-body, inherit); overflow-wrap: anywhere; }
.ndx-card p { margin: 0; color: var(--graview-ink-muted); font-size: 0.88rem; }
a.ndx-card:hover, .ndx-row:hover {
  border-color: color-mix(in oklab, var(--graview-accent) 45%, var(--graview-edge));
  box-shadow: 0 10px 24px -18px color-mix(in oklab, var(--graview-ink) 55%, transparent);
}
a.ndx-card:hover { transform: translateY(-1px); }
.ndx-card.bad { border-color: color-mix(in oklab, var(--graview-bad) 55%, var(--graview-edge)); }
.ndx-card.warn { border-color: color-mix(in oklab, var(--graview-warn) 55%, var(--graview-edge)); }
.ndx-card .ndx-kindline { display: flex; align-items: center; gap: 0.45rem; font-size: 0.74rem; letter-spacing: 0.06em; text-transform: uppercase; color: var(--graview-ink-muted); }

.ndx-meta { display: flex; flex-wrap: wrap; gap: 0.3rem 0.9rem; font-size: 0.82rem; color: var(--graview-ink-muted); }
.ndx-meta b { color: var(--graview-ink); font-weight: 600; }
.ndx-badges { display: flex; flex-wrap: wrap; gap: 0.35rem; align-items: center; }
.ndx-badge {
  display: inline-flex; align-items: center; gap: 0.35rem; padding: 0.2rem 0.6rem 0.2rem 0.5rem; border-radius: 999px;
  font: 600 0.72rem/1.25 var(--graview-font-body, inherit); white-space: nowrap; color: var(--graview-ink);
  background: color-mix(in oklab, var(--graview-ink) 8%, transparent);
}
.ndx-badge::before { content: ""; width: 0.45rem; height: 0.45rem; border-radius: 999px; background: var(--graview-ink-muted); flex: none; }
.ndx-badge.good { background: color-mix(in oklab, var(--graview-good) 18%, transparent); } .ndx-badge.good::before { background: var(--graview-good); }
.ndx-badge.bad { background: color-mix(in oklab, var(--graview-bad) 16%, transparent); } .ndx-badge.bad::before { background: var(--graview-bad); }
.ndx-badge.warn { background: color-mix(in oklab, var(--graview-warn) 24%, transparent); } .ndx-badge.warn::before { background: var(--graview-warn); }
.ndx-badge.accent { background: color-mix(in oklab, var(--graview-accent) 16%, transparent); } .ndx-badge.accent::before { background: var(--graview-accent); }
.ndx-badge.plain::before { display: none; }

.ndx-rows { display: grid; gap: 0.35rem; }
.ndx-row {
  display: grid; grid-template-columns: 1.15rem minmax(0, 1fr) auto; align-items: center; gap: 0.75rem; min-height: 2.75rem;
  padding: 0.55rem 0.85rem; border: 1px solid var(--graview-edge); border-radius: calc(var(--graview-radius, 10px) - 2px);
  background: var(--graview-panel); transition: border-color 0.18s ease, box-shadow 0.18s ease;
}
.ndx-row.past { opacity: 0.74; }
.ndx-row .ndx-title { font-weight: 560; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ndx-row .ndx-sub { font-size: 0.78rem; color: var(--graview-ink-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ndx-row-end { display: flex; gap: 0.4rem; align-items: center; justify-content: flex-end; }
.ndx-kind { width: 1.15rem; height: 1.15rem; color: oklch(var(--ndx-kind-l) 0.13 var(--hue, 250)); flex: none; }
.ndx-depth-1 { margin-left: 1.5rem; } .ndx-depth-2 { margin-left: 3rem; } .ndx-depth-3 { margin-left: 4.5rem; }

.ndx-meter { display: grid; gap: 0.3rem; font-size: 0.78rem; color: var(--graview-ink-muted); }
.ndx-meter > span { display: flex; justify-content: space-between; gap: 0.5rem; }
.ndx-meter > span b { color: var(--graview-ink); font-variant-numeric: tabular-nums; }
.ndx-meter i { display: block; height: 6px; border-radius: 999px; background: color-mix(in oklab, var(--graview-ink) 10%, transparent); overflow: hidden; }
.ndx-meter i b { display: block; height: 100%; border-radius: 999px; width: var(--w, 0%); background: var(--meter, var(--graview-accent)); transition: width 0.6s cubic-bezier(0.2, 0.7, 0.2, 1); }
.ndx-meter.good i b { background: var(--graview-good); } .ndx-meter.bad i b { background: var(--graview-bad); } .ndx-meter.warn i b { background: var(--graview-warn); }

.ndx-empty {
  padding: 1.1rem 1.2rem; display: grid; gap: 0.35rem; color: var(--graview-ink-muted);
  border: 1px dashed var(--graview-edge); border-radius: var(--graview-radius, 10px);
}
.ndx-empty p { margin: 0; }
.ndx-empty code, .ndx-mono { font-family: var(--graview-font-mono, ui-monospace, monospace); font-size: 0.86em; color: var(--graview-ink); }

.ndx-pills { display: flex; flex-wrap: wrap; gap: 0.4rem; }
.ndx-pill {
  min-height: 2rem; padding: 0.35rem 0.75rem; border-radius: 999px; cursor: pointer;
  border: 1px solid var(--graview-edge); background: var(--graview-panel);
  font: 600 0.8rem/1 var(--graview-font-body, inherit); color: var(--graview-ink-muted);
  display: inline-flex; align-items: center; gap: 0.4rem;
}
.ndx-pill:hover { color: var(--graview-ink); }
.ndx-pill[aria-pressed="true"] {
  background: color-mix(in oklab, var(--graview-accent) 14%, var(--graview-panel)); color: var(--graview-ink);
  border-color: color-mix(in oklab, var(--graview-accent) 40%, var(--graview-edge));
}
.ndx-pill .ndx-count { margin-left: 0; }
.ndx-find {
  display: flex; align-items: center; gap: 0.5rem; min-height: 2.25rem; padding: 0.3rem 0.85rem;
  border: 1px solid var(--graview-edge); border-radius: 999px; background: var(--graview-panel); min-width: 13rem; flex: 0 1 22rem;
}
.ndx-find svg { width: 1rem; height: 1rem; color: var(--graview-ink-muted); flex: none; }
.ndx-find input { border: 0; outline: 0; background: transparent; color: inherit; font: inherit; width: 100%; min-width: 0; }
.ndx-btn {
  min-height: 2.25rem; padding: 0.4rem 0.75rem; cursor: pointer; display: inline-flex; gap: 0.4rem; align-items: center;
  border: 1px solid var(--graview-edge); border-radius: calc(var(--graview-radius, 10px) - 2px); background: var(--graview-panel);
  font: 600 0.8rem/1 var(--graview-font-body, inherit); color: var(--graview-ink);
}
.ndx-btn:hover { border-color: color-mix(in oklab, var(--graview-accent) 45%, var(--graview-edge)); }
.ndx-btn svg { width: 1rem; height: 1rem; }
.ndx-btn.quiet { background: transparent; }

.ndx-dl { margin: 0; display: grid; grid-template-columns: minmax(0, max-content) minmax(0, 1fr); gap: 0.45rem 1.25rem; align-items: baseline; }
.ndx-dl dt { color: var(--graview-ink-muted); font-size: 0.85rem; }
.ndx-dl dd { margin: 0; overflow-wrap: anywhere; }
.ndx-prose { max-width: 70ch; white-space: pre-wrap; line-height: 1.6; margin: 0; }
.ndx-muted { color: var(--graview-ink-muted); }
.ndx-small { font-size: 0.82rem; }
.ndx-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.ndx-hr { border: 0; border-top: 1px solid var(--graview-edge); margin: 0.25rem 0; }
.ndx-problem { padding: 0.75rem 0.95rem; border-radius: var(--graview-radius, 10px); background: color-mix(in oklab, var(--graview-warn) 14%, var(--graview-panel)); display: grid; gap: 0.25rem; }
.ndx-problem p { margin: 0; }

.ndx-place {
  display: grid; gap: 0.45rem; padding: 0.95rem 1.05rem; border: 1px solid var(--graview-edge); border-radius: var(--graview-radius, 10px);
  background: linear-gradient(135deg, color-mix(in oklab, var(--graview-accent) 10%, var(--graview-panel)), var(--graview-panel));
  transition: transform 0.18s ease, border-color 0.18s ease;
}
.ndx-place:hover { transform: translateY(-1px); border-color: color-mix(in oklab, var(--graview-accent) 45%, var(--graview-edge)); }
.ndx-place b { font: 650 0.98rem/1.3 var(--graview-font-body, inherit); }
.ndx-place span { font-size: 0.78rem; color: var(--graview-ink-muted); }

.ndx-sync { display: grid; gap: 0.35rem; padding: 0.6rem 0.6rem 0; border-top: 1px solid var(--graview-edge); font-size: 0.78rem; color: var(--graview-ink-muted); }
.ndx-sync p { margin: 0; display: flex; gap: 0.45rem; align-items: center; }
.ndx-sync svg { width: 0.95rem; height: 0.95rem; flex: none; }
.ndx-sync .ndx-btn { justify-self: start; min-height: 1.75rem; padding: 0.25rem 0.6rem; font-size: 0.74rem; }

.ndx-rise { animation: ndx-rise 0.5s cubic-bezier(0.2, 0.7, 0.2, 1) both; animation-delay: calc(var(--i, 0) * 35ms); }
@keyframes ndx-rise { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) {
  .ndx-rise { animation: none; }
  .ndx-card, .ndx-row, .ndx-place, .ndx-meter i b { transition: none; }
}

@media (max-width: 56rem) {
  .ndx { grid-template-columns: 1fr; }
  .ndx-rail {
    position: sticky; top: 0; height: auto; display: flex; gap: 0.3rem; overflow-x: auto; align-items: center;
    border-right: 0; border-bottom: 1px solid var(--graview-edge); padding: 0.55rem 0.75rem; scrollbar-width: none;
  }
  .ndx-rail::-webkit-scrollbar { display: none; }
  .ndx-brand { padding: 0.2rem 0.4rem; } .ndx-brand small { display: none; } .ndx-brand svg { width: 1.6rem; height: 1.6rem; }
  .ndx-group, .ndx-nav { display: contents; }
  .ndx-group h2 { display: none; }
  .ndx-nav a { white-space: nowrap; padding: 0.4rem 0.6rem; }
  .ndx-nav a[aria-current="page"]::before { display: none; }
  .ndx-tools { margin-left: auto; flex-wrap: nowrap; }
  .ndx-main { padding: 1.25rem 1rem 3rem; }
  .ndx-row { grid-template-columns: 1.15rem minmax(0, 1fr); }
  .ndx-row-end { grid-column: 2; justify-content: flex-start; }
}
`;
