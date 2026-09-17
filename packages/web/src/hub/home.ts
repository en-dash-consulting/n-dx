/**
 * The hub's home page: one card per registered project.
 *
 * With several repositories registered, `/` has to answer "which one?" — and
 * the answer people actually use is not a list of names. It is which branch
 * each is on, whether it has uncommitted work, whether an agent is running in
 * it right now, and how far its PRD has got. Those come from
 * `overview.ts`; this module is only the rendering.
 *
 * ## Why this is server-rendered rather than a built bundle
 *
 * The landing page (`src/landing/`) is a built entry because it is a real
 * page with a real amount of behaviour. This one is a chooser: you look at it
 * for two seconds and click through. Making it a bundle would mean a build
 * output, a static route the hub does not otherwise have, and a second copy
 * of the asset-serving logic — for a page whose whole job is to be left. So
 * the hub renders it, and a small inline script re-reads
 * `/api/hub/overview` so a card that changes while you are looking at it
 * updates without a reload.
 *
 * ## Theme
 *
 * The same mechanism the viewer uses, not the same component: the hub zone
 * must not import from `src/viewer/` (see packages/web/CLAUDE.md), and the
 * viewer's toggle is a Preact component this page has no runtime for. What is
 * shared is what matters — the `sv-theme` localStorage key and the
 * `data-theme` attribute — so a theme chosen here is the theme the dashboard
 * opens in, and vice versa. The token values below mirror
 * `viewer/styles/tokens.css` for the handful of colours this page uses;
 * importing that file would mean reaching into a built viewer asset from the
 * one zone that is not allowed to.
 *
 * @module web/hub/home
 */

import type { HubOverview, ProjectCard } from "./overview.js";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** "3 uncommitted", "clean", or nothing when git could not be asked. */
export function dirtyLabel(card: ProjectCard): string | null {
  if (card.dirtyFiles === null) return null;
  return card.dirtyFiles === 0 ? "clean" : `${card.dirtyFiles} uncommitted`;
}

/** "42% complete", or null when the project has no PRD. */
export function progressLabel(card: ProjectCard): string | null {
  return card.percentComplete === null ? null : `${card.percentComplete}% complete`;
}

/** "2 running", or null when nothing is. A count is only worth a badge when it is not zero. */
export function runningLabel(card: ProjectCard): string | null {
  return card.activeRuns ? `${card.activeRuns} running` : null;
}

/**
 * The card's one-line summary, in the order someone scanning for a project
 * reads it: what it is doing, then what state it is in, then what is next.
 */
export function cardFacts(card: ProjectCard): string[] {
  if (!card.reachable) {
    return [card.error ? `not answering — ${card.error}` : "not answering"];
  }
  const facts: string[] = [];
  const running = runningLabel(card);
  if (running) facts.push(running);
  if (card.branch) facts.push(card.branch);
  const dirty = dirtyLabel(card);
  if (dirty) facts.push(dirty);
  const progress = progressLabel(card);
  if (progress) facts.push(progress);
  return facts;
}

const STYLES = `
:root {
  color-scheme: dark;
  --bg: #0c0e1a; --bg-surface: #151829; --bg-hover: #1e2240;
  --border: #2a2f4a; --border-strong: #3d4470;
  --text: #e8eaf0; --text-dim: #9ea3bc; --text-muted: #868aaa;
  --accent: #00c39a; --green: #00bd81; --orange: #ff8060; --red: #ff7f9c;
}
[data-theme="light"] {
  color-scheme: light;
  --bg: #f5f6fa; --bg-surface: #ffffff; --bg-hover: #eef0f6;
  --border: #d8dce6; --border-strong: #bcc2d4;
  --text: #1a1d2e; --text-dim: #5c6078; --text-muted: #6b6e88;
  --accent: #006E4E; --green: #006E4A; --orange: #B03800; --red: #B01A54;
}
* { box-sizing: border-box; }
body {
  margin: 0; padding: 2.5rem 1.5rem; background: var(--bg); color: var(--text);
  font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
}
.wrap { max-width: 60rem; margin: 0 auto; }
header { display: flex; align-items: baseline; gap: 1rem; margin-bottom: 1.5rem; }
h1 { font-size: 1.25rem; margin: 0; font-weight: 600; }
.count { color: var(--text-muted); font-size: 0.8rem; }
.theme-toggle {
  margin-left: auto; background: var(--bg-surface); color: var(--text-dim);
  border: 1px solid var(--border); border-radius: 6px; padding: 0.35rem 0.6rem;
  font: inherit; font-size: 0.75rem; cursor: pointer;
}
.theme-toggle:hover { background: var(--bg-hover); color: var(--text); }
.cards { display: grid; gap: 0.75rem; grid-template-columns: repeat(auto-fill, minmax(18rem, 1fr)); list-style: none; margin: 0; padding: 0; }
.card {
  background: var(--bg-surface); border: 1px solid var(--border); border-radius: 10px;
  padding: 1rem; display: flex; flex-direction: column; gap: 0.5rem; min-width: 0;
}
.card-unreachable { border-color: var(--border-strong); opacity: 0.75; }
.card-title { display: flex; align-items: baseline; gap: 0.5rem; min-width: 0; }
.card-title a { color: var(--text); text-decoration: none; font-weight: 600; font-size: 1rem; }
.card-title a:hover { color: var(--accent); text-decoration: underline; }
.dot { width: 0.5rem; height: 0.5rem; border-radius: 50%; flex-shrink: 0; background: var(--text-muted); }
.dot-healthy { background: var(--green); }
.dot-starting { background: var(--orange); }
.dot-unreachable, .dot-stopped { background: var(--red); }
.path { color: var(--text-muted); font-size: 0.72rem; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; overflow-wrap: anywhere; }
.facts { display: flex; flex-wrap: wrap; gap: 0.35rem; }
.fact { font-size: 0.72rem; color: var(--text-dim); background: var(--bg-hover); border-radius: 4px; padding: 0.1rem 0.4rem; }
.fact-running { color: var(--accent); font-weight: 600; }
.fact-error { color: var(--red); background: none; padding: 0; }
.next { color: var(--text-dim); font-size: 0.78rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.actions { display: flex; gap: 0.5rem; margin-top: auto; padding-top: 0.25rem; }
.action {
  font: inherit; font-size: 0.78rem; text-decoration: none; border-radius: 6px;
  padding: 0.35rem 0.7rem; border: 1px solid var(--border-strong); color: var(--text-dim);
  background: var(--bg-hover);
}
.action:hover { color: var(--text); border-color: var(--accent); }
.action-primary { color: var(--bg); background: var(--accent); border-color: var(--accent); font-weight: 600; }
.action-primary:hover { color: var(--bg); opacity: 0.9; }
a:focus-visible, button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.empty { color: var(--text-dim); }
.empty code { background: var(--bg-hover); padding: 0.1rem 0.35rem; border-radius: 4px; }
`;

/**
 * Re-read the overview and swap the card list. Deliberately small: it re-uses
 * the server's own markup rather than re-implementing the cards in the
 * browser, so there is one renderer, not two that can disagree.
 */
const REFRESH_SCRIPT = `
(function () {
  var list = document.getElementById("cards");
  if (!list) return;
  function tick() {
    fetch("/api/hub/overview", { headers: { accept: "application/json" } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data || !data.html) return;
        // Never yank focus out from under someone mid-keyboard-navigation.
        if (list.contains(document.activeElement)) return;
        list.innerHTML = data.html;
      })
      .catch(function () {});
  }
  setInterval(tick, 5000);
})();
`;

function statusDot(card: ProjectCard): string {
  const state = card.reachable ? card.state : "unreachable";
  return `<span class="dot dot-${escapeHtml(state)}" title="${escapeHtml(state)}" aria-hidden="true"></span>`;
}

/** One card. Exported so the refresh endpoint renders exactly what the page did. */
export function renderCard(card: ProjectCard): string {
  const facts = cardFacts(card)
    .map((fact, index) => {
      const cls = !card.reachable ? "fact fact-error" : index === 0 && runningLabel(card) ? "fact fact-running" : "fact";
      return `<span class="${cls}">${escapeHtml(fact)}</span>`;
    })
    .join("");

  const next = card.nextTaskTitle
    ? `<p class="next" title="${escapeHtml(card.nextTaskTitle)}">Next: ${escapeHtml(card.nextTaskTitle)}</p>`
    : "";

  // "Start working" is a link into the project's Runs view, where the existing
  // Start Task button lives. The hub does not get its own execute route: one
  // path into starting a run, and it is the one that already works.
  const actions = card.reachable
    ? `<div class="actions">
      <a class="action action-primary" href="${escapeHtml(card.url)}hench-runs">Start working</a>
      <a class="action" href="${escapeHtml(card.url)}">Open dashboard</a>
    </div>`
    : `<div class="actions"><a class="action" href="${escapeHtml(card.url)}">Open dashboard</a></div>`;

  return `<li class="card${card.reachable ? "" : " card-unreachable"}">
    <div class="card-title">${statusDot(card)}<a href="${escapeHtml(card.url)}">${escapeHtml(card.name)}</a></div>
    <p class="path">${escapeHtml(card.repoRoot)}</p>
    <div class="facts">${facts}</div>
    ${next}
    ${actions}
  </li>`;
}

/** Just the cards, for the refresh tick. */
export function renderCards(overview: HubOverview): string {
  return overview.projects.map(renderCard).join("");
}

/** The whole page. */
export function renderHomePage(overview: HubOverview): string {
  const { projects } = overview;
  const body = projects.length === 0
    ? `<p class="empty">No project is registered. Run <code>ndx start</code> in a repository to register it.</p>`
    : `<ul class="cards" id="cards">${renderCards(overview)}</ul>`;

  const count = projects.length === 1 ? "1 project" : `${projects.length} projects`;

  return `<!doctype html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>n-dx hub</title>
<script>
  // Before first paint, so the page never flashes the wrong theme. Same key
  // and attribute the dashboard uses, so the choice carries across.
  (function () {
    try {
      var stored = localStorage.getItem("sv-theme");
      var theme = stored || (window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
      document.documentElement.setAttribute("data-theme", theme);
    } catch (e) { /* private mode — the dark default stands */ }
  })();
</script>
<style>${STYLES}</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>n-dx hub</h1>
    <span class="count">${escapeHtml(count)}</span>
    <button class="theme-toggle" type="button" id="theme-toggle" aria-label="Toggle colour theme">Theme</button>
  </header>
  ${body}
</div>
<script>
  (function () {
    var button = document.getElementById("theme-toggle");
    if (!button) return;
    button.addEventListener("click", function () {
      var next = document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light";
      document.documentElement.setAttribute("data-theme", next);
      try { localStorage.setItem("sv-theme", next); } catch (e) { /* not persisted, still applied */ }
    });
  })();
</script>
<script>${REFRESH_SCRIPT}</script>
</body>
</html>`;
}
