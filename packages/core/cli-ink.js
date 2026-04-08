/**
 * Ink-based animated terminal UI for n-dx commands.
 *
 * Uses htm/react for JSX-like templates without a build step.
 * Dynamically imported by cli.js only when a TTY is available,
 * so the React/Ink dependency doesn't affect non-interactive commands.
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

// ── Spinner component ──────────────────────────────────────────────────

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function Spinner() {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => {
      setFrame((f) => (f + 1) % SPINNER_FRAMES.length);
    }, 80);
    return () => clearInterval(timer);
  }, []);
  return html`<${Text} color="magenta">${SPINNER_FRAMES[frame]}<//>`;
}

// ── DinoMascot component ───────────────────────────────────────────────

const WALK_RANGE = 20;
const WALK_SPEED_MS = 250;
const LEG_CHANGE_STEPS = 3;

function DinoMascot() {
  const [x, setX] = useState(0);
  const [legFrame, setLegFrame] = useState(0);
  const dirRef = useRef(1);
  const stepRef = useRef(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setX((prev) => {
        let next = prev + dirRef.current;
        if (next >= WALK_RANGE || next <= 0) dirRef.current *= -1;
        next = Math.max(0, Math.min(WALK_RANGE, next));
        return next;
      });
      stepRef.current++;
      if (stepRef.current % LEG_CHANGE_STEPS === 0) {
        setLegFrame((f) => (f + 1) % LEGS.length);
      }
    }, WALK_SPEED_MS);
    return () => clearInterval(timer);
  }, []);

  const pad = " ".repeat(x);
  const allLines = [...BODY, ...LEGS[legFrame]];

  return html`
    <${Box} flexDirection="column">
      ${allLines.map(
        (line, i) =>
          html`<${Text} key=${i} color="magenta">${pad}${line}<//>`,
      )}
    <//>
  `;
}

// ── PhaseRow component ─────────────────────────────────────────────────

function PhaseRow({ name, status, detail }) {
  const phase = INIT_PHASES[name];
  if (!phase) return null;

  if (status === "active") {
    return html`
      <${Box}>
        <${Text}>  <//>
        <${Spinner} />
        <${Text}> ${phase.spinner}<//>
      <//>
    `;
  }

  if (status === "done") {
    const suffix = detail ? html`<${Text} dimColor> (${detail})<//>` : null;
    return html`
      <${Box}>
        <${Text} color="green">  ✓<//>
        <${Text}> ${phase.success}<//>
        ${suffix}
      <//>
    `;
  }

  if (status === "failed") {
    return html`
      <${Box}>
        <${Text} color="red">  ✗<//>
        <${Text}> ${name} failed<//>
      <//>
    `;
  }

  return null; // pending — not shown yet
}

// ── RecapPanel component ───────────────────────────────────────────────

function RecapPanel({ sourcevision, rex, hench, provider, claudeCode }) {
  return html`
    <${Box} flexDirection="column" marginTop=${1}>
      <${Box}>
        <${Text} color="green">  ◆<//>
        <${Text} bold> Project initialized!<//>
      <//>
      <${Text} />
      <${Text}>  .sourcevision/  ${sourcevision}<//>
      <${Text}>  .rex/           ${rex}<//>
      <${Text}>  .hench/         ${hench}<//>
      <${Text}>  LLM provider    ${provider}<//>
      <${Text}>  Claude Code     ${claudeCode}<//>
      <${Text} />
      <${Text} dimColor>  Next: ${TOOL_NAME} plan . — analyze your codebase<//>
    <//>
  `;
}

// ── InitApp — orchestrates the full init flow ──────────────────────────

function InitApp({ dir, flags, provider, providerSource, noClaude, tools, runInitCapture, runConfig, setupClaudeIntegration, onComplete }) {
  const [phases, setPhases] = useState([]);
  const [recap, setRecap] = useState(null);
  const startedRef = useRef(false);

  function addPhase(name, status, detail) {
    setPhases((prev) => {
      const existing = prev.findIndex((p) => p.name === name);
      if (existing >= 0) {
        const next = [...prev];
        next[existing] = { name, status, detail };
        return next;
      }
      return [...prev, { name, status, detail }];
    });
  }

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    (async () => {
      const svExists = existsSync(join(dir, ".sourcevision"));
      const rexExists = existsSync(join(dir, ".rex"));
      const henchExists = existsSync(join(dir, ".hench"));

      // Phase: sourcevision
      addPhase("sourcevision", "active");
      const svResult = await runInitCapture(tools.sourcevision, ["init", ...flags, dir]);
      if (svResult.code !== 0) {
        addPhase("sourcevision", "failed");
        onComplete(1, svResult.stderr || svResult.stdout);
        return;
      }
      addPhase("sourcevision", "done", svExists ? "reused" : undefined);

      // Phase: rex
      addPhase("rex", "active");
      const rexResult = await runInitCapture(tools.rex, ["init", ...flags, dir]);
      if (rexResult.code !== 0) {
        addPhase("rex", "failed");
        onComplete(1, rexResult.stderr || rexResult.stdout);
        return;
      }
      addPhase("rex", "done", rexExists ? "reused" : undefined);

      // Phase: hench
      addPhase("hench", "active");
      const henchResult = await runInitCapture(tools.hench, ["init", ...flags, dir]);
      if (henchResult.code !== 0) {
        addPhase("hench", "failed");
        onComplete(1, henchResult.stderr || henchResult.stdout);
        return;
      }
      addPhase("hench", "done", henchExists ? "reused" : undefined);

      // Set provider (silent)
      const origLog = console.log;
      console.log = () => {};
      try { await runConfig(["llm.vendor", provider, dir]); } finally { console.log = origLog; }

      // Phase: Claude Code integration
      let claudeSummary = "skipped";
      if (!noClaude) {
        addPhase("claude", "active");
        try {
          const result = setupClaudeIntegration(dir);
          claudeSummary = `${result.skills.written} skills, ${result.settings.total} permissions`;
          addPhase("claude", "done", claudeSummary);
        } catch {
          claudeSummary = "skipped";
          addPhase("claude", "done", "skipped");
        }
      }

      const recapData = {
        sourcevision: svExists ? "already exists (reused)" : "created",
        rex: rexExists ? "already exists (reused)" : "created",
        hench: henchExists ? "already exists (reused)" : "created",
        provider: `${provider} (${providerSource})`,
        claudeCode: claudeSummary,
      };
      setRecap(recapData);

      // Give time for final render before completing
      setTimeout(() => onComplete(0), 100);
    })();
  }, []);

  return html`
    <${Box} flexDirection="column">
      <${DinoMascot} />
      <${Box} marginTop=${1} marginBottom=${1} paddingLeft=${2}>
        <${Text} bold color="magenta">${BRAND_NAME}<//>
        <${Text}>  <//>
        <${Text} dimColor>${TOOL_NAME} init<//>
      <//>
      ${phases.map(
        (p) => html`<${PhaseRow} key=${p.name} ...${p} />`,
      )}
      ${recap && html`<${RecapPanel} ...${recap} />`}
    <//>
  `;
}

// ── Public API ─────────────────────────────────────────────────────────

/**
 * Render the animated init UI using Ink.
 *
 * @param {object} opts
 * @param {string} opts.dir - Project directory
 * @param {string[]} opts.flags - CLI flags
 * @param {string} opts.provider - Selected LLM provider
 * @param {string} opts.providerSource - How provider was determined
 * @param {boolean} opts.noClaude - Skip Claude integration
 * @param {object} opts.tools - Tool paths (sourcevision, rex, hench)
 * @param {function} opts.runInitCapture - Spawn an init subprocess
 * @param {function} opts.runConfig - Run config command
 * @param {function} opts.setupClaudeIntegration - Setup Claude Code
 * @returns {Promise<{ code: number, error?: string }>}
 */
export function renderInit(opts) {
  return new Promise((resolve) => {
    const { unmount } = render(
      html`<${InitApp}
        ...${opts}
        onComplete=${(code, error) => {
          unmount();
          resolve({ code, error });
        }}
      />`,
    );
  });
}
