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
 * must not import from `src/viewer/` (see packages/web/AGENTS.md), and the
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
#new-toggle { margin-left: auto; }
.theme-toggle { background: var(--bg-surface); color: var(--text-dim);
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

/* New-project form */
.new-btn {
  background: var(--accent); color: var(--bg); border: 1px solid var(--accent);
  border-radius: 6px; padding: 0.35rem 0.7rem; font: inherit; font-size: 0.78rem;
  font-weight: 600; cursor: pointer;
}
.new-btn:hover { opacity: 0.9; }
.new-panel {
  background: var(--bg-surface); border: 1px solid var(--border); border-radius: 10px;
  padding: 1rem; margin-bottom: 1.25rem; display: grid; gap: 0.75rem;
}
.new-panel[hidden] { display: none; }
.new-row { display: grid; gap: 0.75rem; grid-template-columns: 2fr 1fr; }
@media (max-width: 34rem) { .new-row { grid-template-columns: 1fr; } }
.new-field { display: grid; gap: 0.25rem; min-width: 0; }
.new-field label { font-size: 0.72rem; color: var(--text-dim); }
.new-field input {
  background: var(--bg); color: var(--text); border: 1px solid var(--border);
  border-radius: 6px; padding: 0.4rem 0.55rem; font: inherit; font-size: 0.82rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; min-width: 0;
}
.new-field input:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.new-preview {
  font-size: 0.75rem; color: var(--text-dim); margin: 0;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; overflow-wrap: anywhere;
}
.new-preview strong { color: var(--text); font-weight: 600; }
.new-problem { color: var(--red); }
.new-note { color: var(--orange); }
.new-actions { display: flex; align-items: center; gap: 0.75rem; }
.new-actions button[disabled] { opacity: 0.5; cursor: not-allowed; }
.new-cancel {
  background: var(--bg-hover); color: var(--text-dim); border: 1px solid var(--border-strong);
  border-radius: 6px; padding: 0.35rem 0.7rem; font: inherit; font-size: 0.78rem; cursor: pointer;
}
.new-status { font-size: 0.78rem; color: var(--text-dim); display: flex; align-items: center; gap: 0.4rem; }
.new-status[hidden] { display: none; }
.new-status-error { color: var(--red); }
.spinner {
  width: 0.85rem; height: 0.85rem; border-radius: 50%; flex-shrink: 0;
  border: 2px solid var(--border-strong); border-top-color: var(--accent);
  animation: spin 0.7s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) {
  .spinner { animation-duration: 2.4s; }
}
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

/**
 * The new-project form: preview as you type, then create.
 *
 * Two things it must never do. It must not create a folder the operator has
 * not seen the full path of — hence the preview line, refreshed from the
 * server (which resolves the path, so `~`, `..` and a relative parent all
 * display as what they actually are) rather than joined together in the
 * browser. And it must not look idle while it works: creating the folder,
 * starting its server and waiting for it to answer takes seconds, so the
 * button goes busy and says which of those is happening.
 */
const NEW_PROJECT_SCRIPT = `
(function () {
  // The panel *is* the form — one element, so there is no arrangement in
  // which the fields are on screen but the submit handler is not wired.
  var form = document.getElementById("new-panel");
  var toggle = document.getElementById("new-toggle");
  if (!form || !toggle) return;
  var panel = form;
  var parentInput = document.getElementById("new-parent");
  var nameInput = document.getElementById("new-name");
  var preview = document.getElementById("new-preview");
  var submit = document.getElementById("new-submit");
  var status = document.getElementById("new-status");
  var statusText = document.getElementById("new-status-text");
  var spinner = document.getElementById("new-spinner");
  var timer = null;
  var busy = false;

  function setStatus(message, isError, spinning) {
    status.hidden = !message;
    statusText.textContent = message || "";
    status.className = isError ? "new-status new-status-error" : "new-status";
    spinner.hidden = !spinning;
  }

  function render(data) {
    if (busy) return;
    var path = data.path || "";
    if (data.problem) {
      preview.innerHTML = '<span class="new-problem"></span>';
      preview.firstChild.textContent = data.problem;
      submit.disabled = true;
      return;
    }
    preview.textContent = "Will create: ";
    var strong = document.createElement("strong");
    strong.textContent = path;
    preview.appendChild(strong);
    if (data.note) {
      var note = document.createElement("span");
      note.className = "new-note";
      note.textContent = " — " + data.note;
      preview.appendChild(note);
    }
    submit.disabled = false;
  }

  function query(opts) {
    var params = new URLSearchParams({ parent: parentInput.value, name: nameInput.value });
    return fetch("/api/hub/new-project?" + params.toString(), { headers: { accept: "application/json" } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data) return;
        if (opts && opts.fillParent && !parentInput.value) parentInput.value = data.defaultParent || "";
        render(data);
      })
      .catch(function () {});
  }

  function schedule() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(query, 180);
  }

  toggle.addEventListener("click", function () {
    var opening = panel.hidden;
    panel.hidden = !opening;
    toggle.setAttribute("aria-expanded", String(opening));
    if (opening) {
      query({ fillParent: true });
      nameInput.focus();
    }
  });

  var cancel = document.getElementById("new-cancel");
  if (cancel) {
    cancel.addEventListener("click", function () {
      panel.hidden = true;
      toggle.setAttribute("aria-expanded", "false");
      toggle.focus();
    });
  }

  parentInput.addEventListener("input", schedule);
  nameInput.addEventListener("input", schedule);

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    if (busy || submit.disabled) return;
    busy = true;
    submit.disabled = true;
    setStatus("Creating the folder and starting its server…", false, true);
    fetch("/api/hub/projects/new", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ parent: parentInput.value, name: nameInput.value })
    })
      .then(function (r) { return r.json().then(function (body) { return { status: r.status, body: body }; }); })
      .then(function (result) {
        if (result.status === 201) {
          setStatus("Opening setup for " + result.body.path + "…", false, true);
          location.href = result.body.url;
          return;
        }
        busy = false;
        submit.disabled = false;
        setStatus(result.body.error || ("Could not create the project (HTTP " + result.status + ")."), true, false);
      })
      .catch(function (err) {
        busy = false;
        submit.disabled = false;
        setStatus(String(err && err.message ? err.message : err), true, false);
      });
  });

  // Prefill the suggested parent even before the panel is opened, so the
  // first thing shown is a real path rather than an empty box.
  query({ fillParent: true });
})();
`;

/**
 * The new-project panel. `defaultParent` is rendered into the field rather
 * than fetched, so the path is on screen in the first paint — the script
 * refreshes it, but a slow or failed fetch still leaves something true there.
 */
export function renderNewProjectPanel(defaultParent: string): string {
  return `<form class="new-panel" id="new-panel" hidden>
    <div class="new-row">
      <div class="new-field">
        <label for="new-parent">Folder it goes in</label>
        <input type="text" id="new-parent" name="parent" value="${escapeHtml(defaultParent)}" spellcheck="false" autocomplete="off">
      </div>
      <div class="new-field">
        <label for="new-name">Project folder name</label>
        <input type="text" id="new-name" name="name" placeholder="my-project" spellcheck="false" autocomplete="off">
      </div>
    </div>
    <p class="new-preview" id="new-preview" role="status" aria-live="polite">Will create: <strong>${escapeHtml(defaultParent)}</strong></p>
    <div class="new-actions">
      <button type="submit" class="new-btn" id="new-submit" disabled>Create and set up</button>
      <button type="button" class="new-cancel" id="new-cancel">Cancel</button>
      <span class="new-status" id="new-status" role="status" aria-live="polite" hidden>
        <span class="spinner" id="new-spinner" aria-hidden="true" hidden></span>
        <span id="new-status-text"></span>
      </span>
    </div>
  </form>`;
}

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

/**
 * The whole page.
 *
 * @param defaultParent Directory the new-project form offers to create in —
 *   {@link defaultParentDir}'s answer, passed in rather than computed here so
 *   this module stays pure rendering.
 */
export function renderHomePage(overview: HubOverview, defaultParent = ""): string {
  const { projects } = overview;
  const body = projects.length === 0
    ? `<p class="empty">No project is registered yet. Create one above, or run <code>ndx start</code> in a repository you already have.</p>`
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
    <button class="new-btn" type="button" id="new-toggle" aria-expanded="false" aria-controls="new-panel">New project</button>
    <button class="theme-toggle" type="button" id="theme-toggle" aria-label="Toggle colour theme">Theme</button>
  </header>
  ${renderNewProjectPanel(defaultParent)}
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
<script>${NEW_PROJECT_SCRIPT}</script>
</body>
</html>`;
}
