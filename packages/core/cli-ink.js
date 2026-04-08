/**
 * Ink-based animated terminal UI for n-dx commands.
 *
 * Uses htm/react for JSX-like templates without a build step.
 * Dynamically imported only when a TTY is available.
 *
 * @module n-dx/cli-ink
 */

import { useState, useEffect, useRef } from "react";
import { render, Box, Text } from "ink";
import { html } from "htm/react";
import { existsSync } from "fs";
import { join } from "path";
import {
  BRAND_NAME,
  TOOL_NAME,
  BODY,
  LEGS,
  INIT_PHASES,
} from "./cli-brand.js";

// ── Spinner ────────────────────────────────────────────────────────────

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function Spinner() {
  const [f, setF] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setF((i) => (i + 1) % FRAMES.length), 80);
    return () => clearInterval(t);
  }, []);
  return html`<${Text} color="magenta">${FRAMES[f]}<//>`;
}

// ── Walking dino header ────────────────────────────────────────────────

const WALK_RANGE = 20;

function DinoHeader() {
  const [x, setX] = useState(0);
  const [leg, setLeg] = useState(0);
  const dir = useRef(1);
  const step = useRef(0);

  useEffect(() => {
    const t = setInterval(() => {
      setX((prev) => {
        let next = prev + dir.current;
        if (next >= WALK_RANGE || next <= 0) dir.current *= -1;
        return Math.max(0, Math.min(WALK_RANGE, next));
      });
      step.current++;
      if (step.current % 3 === 0) setLeg((l) => (l + 1) % LEGS.length);
    }, 200);
    return () => clearInterval(t);
  }, []);

  const pad = " ".repeat(x);
  const lines = [...BODY, ...LEGS[leg]];

  return html`
    <${Box} flexDirection="column" borderStyle="round" borderColor="magenta" paddingX=${1}>
      ${lines.map(
        (l, i) => html`<${Text} key=${i} color="magenta">${pad}${l}<//>`,
      )}
      <${Text}> <//>
      <${Text} bold color="magenta">  ${BRAND_NAME}  <${Text} dimColor>${TOOL_NAME} init<//><//>
    <//>
  `;
}

// ── Phase row ──────────────────────────────────────────────────────────

function PhaseRow({ name, status, detail }) {
  const phase = INIT_PHASES[name];
  if (!phase || status === "pending") return null;

  if (status === "active") {
    return html`<${Box} gap=${1} paddingLeft=${2}>
      <${Spinner} /><${Text}> ${phase.spinner}<//>
    <//>`;
  }
  if (status === "done") {
    return html`<${Box} paddingLeft=${2}>
      <${Text} color="green">✓<//><${Text}> ${phase.success}${detail ? " " : ""}<//>${detail ? html`<${Text} dimColor>(${detail})<//>` : null}
    <//>`;
  }
  if (status === "failed") {
    return html`<${Box} paddingLeft=${2}>
      <${Text} color="red">✗<//><${Text}> ${name} failed<//>
    <//>`;
  }
  return null;
}

// ── Recap ──────────────────────────────────────────────────────────────

function Recap({ sourcevision, rex, hench, provider, claudeCode }) {
  return html`
    <${Box} flexDirection="column" marginTop=${1}>
      <${Box} paddingLeft=${2} gap=${1}>
        <${Text} color="green">◆<//><${Text} bold>Project initialized!<//>
      <//>
      <${Text}> <//>
      <${Text}>  .sourcevision/  ${sourcevision}<//>
      <${Text}>  .rex/           ${rex}<//>
      <${Text}>  .hench/         ${hench}<//>
      <${Text}>  LLM provider    ${provider}<//>
      <${Text}>  Claude Code     ${claudeCode}<//>
      <${Text}> <//>
      <${Text} dimColor>  Next: ${TOOL_NAME} plan . — analyze your codebase<//>
    <//>
  `;
}

// ── Init app ───────────────────────────────────────────────────────────

function InitApp({ dir, flags, provider, providerSource, noClaude, tools, runInitCapture, runConfig, setupClaudeIntegration, onComplete }) {
  const [phases, setPhases] = useState([]);
  const [recap, setRecap] = useState(null);
  const started = useRef(false);

  function setPhase(name, status, detail) {
    setPhases((prev) => {
      const idx = prev.findIndex((p) => p.name === name);
      const entry = { name, status, detail };
      if (idx >= 0) { const next = [...prev]; next[idx] = entry; return next; }
      return [...prev, entry];
    });
  }

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    (async () => {
      // Yield to let Ink render between state updates
      const tick = () => new Promise((r) => setTimeout(r, 0));

      const svExists = existsSync(join(dir, ".sourcevision"));
      const rexExists = existsSync(join(dir, ".rex"));
      const henchExists = existsSync(join(dir, ".hench"));

      // sourcevision
      setPhase("sourcevision", "active");
      await tick();
      const sv = await runInitCapture(tools.sourcevision, ["init", ...flags, dir]);
      if (sv.code !== 0) { setPhase("sourcevision", "failed"); onComplete(1, sv.stderr || sv.stdout); return; }
      setPhase("sourcevision", "done", svExists ? "reused" : undefined);

      // rex
      setPhase("rex", "active");
      await tick();
      const rx = await runInitCapture(tools.rex, ["init", ...flags, dir]);
      if (rx.code !== 0) { setPhase("rex", "failed"); onComplete(1, rx.stderr || rx.stdout); return; }
      setPhase("rex", "done", rexExists ? "reused" : undefined);

      // hench
      setPhase("hench", "active");
      await tick();
      const hx = await runInitCapture(tools.hench, ["init", ...flags, dir]);
      if (hx.code !== 0) { setPhase("hench", "failed"); onComplete(1, hx.stderr || hx.stdout); return; }
      setPhase("hench", "done", henchExists ? "reused" : undefined);

      // Provider config and Claude integration are sync/CPU-bound.
      // Run them via setImmediate so Ink gets real event-loop turns
      // to keep the animation alive between each blocking chunk.
      const yieldFrame = () => new Promise((r) => setImmediate(r));

      // provider config (silent)
      setPhase("claude", "active");
      await yieldFrame();
      const origLog = console.log;
      console.log = () => {};
      try { await runConfig(["llm.vendor", provider, dir]); } finally { console.log = origLog; }
      await yieldFrame();

      // claude integration
      let claudeSummary = "skipped";
      if (!noClaude) {
        try {
          const r = setupClaudeIntegration(dir);
          claudeSummary = `${r.skills.written} skills, ${r.settings.total} permissions`;
        } catch {
          /* skip */
        }
        await yieldFrame();
      }
      setPhase("claude", "done", claudeSummary === "skipped" ? "skipped" : claudeSummary);

      setRecap({
        sourcevision: svExists ? "already exists (reused)" : "created",
        rex: rexExists ? "already exists (reused)" : "created",
        hench: henchExists ? "already exists (reused)" : "created",
        provider: `${provider} (${providerSource})`,
        claudeCode: claudeSummary,
      });

      // Let the dino keep walking while the user reads the recap
      setTimeout(() => onComplete(0), 2000);
    })();
  }, []);

  return html`
    <${Box} flexDirection="column">
      <${DinoHeader} />
      <${Text}> <//>
      ${phases.map((p) => html`<${PhaseRow} key=${p.name} ...${p} />`)}
      ${recap && html`<${Recap} ...${recap} />`}
    <//>
  `;
}

// ── Public API ─────────────────────────────────────────────────────────

export function renderInit(opts) {
  return new Promise((resolve) => {
    const { unmount } = render(
      html`<${InitApp} ...${opts} onComplete=${(code, error) => {
        unmount();
        resolve({ code, error });
      }} />`,
    );
  });
}
