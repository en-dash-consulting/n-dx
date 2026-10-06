/**
 * v2 product-layer and change-layer fixtures for the Product page, the
 * Changes view and the capability page.
 *
 * Shaped like a small but complete map rather than a minimal one: every
 * capability status and both health values appear at least once, changes span
 * two planned releases plus an unscheduled backlog, and one capability is both
 * revised and defective so the attention path is exercised by a real row.
 *
 * These stand in for the v2 reader, which is a separate piece of work. When it
 * lands, the routes feed the same shapes and these fixtures keep testing the
 * views in isolation.
 */

import type {
  CapabilityDetail,
  ChangeRow,
  ProductMap,
} from "../../src/viewer/views/product-model.js";

export const PRODUCT_MAP_FIXTURE: ProductMap = {
  statement: "A toolkit that analyses a codebase, plans the work, and executes it.",
  areas: [
    {
      id: "area-define",
      displayId: "A1",
      title: "Define the product",
      summary: "Capturing intent as a map people can read without reading history.",
      stewards: ["Sterling H"],
      capabilities: [
        {
          id: "cap-natural-language-authoring",
          displayId: "A1.1",
          title: "Natural-language authoring",
          statement: "A person describes work in prose and the toolkit files it in the right place.",
          status: "met",
          health: "ok",
          specReviewed: true,
          criteriaCount: 3,
          openChanges: [],
        },
        {
          id: "cap-placement",
          displayId: "A1.2",
          title: "Automatic placement",
          statement: "A captured change lands under the capability it amends without being told.",
          status: "changing",
          health: "ok",
          specReviewed: true,
          criteriaCount: 2,
          openChanges: [
            {
              id: "change-placement-engine",
              displayId: "CH-142",
              title: "Placement engine for changes",
              stage: "in-progress",
              delta: "modified",
            },
          ],
        },
        {
          id: "cap-spec-review",
          displayId: "A1.3",
          title: "Steward spec review",
          statement: "A steward signs off a capability's spec before it counts as met.",
          status: "proposed",
          health: "ok",
          criteriaCount: 0,
          openChanges: [
            {
              id: "change-stewards",
              displayId: "CH-151",
              title: "Stewards and code-owner files",
              stage: "proposed",
              delta: "added",
            },
          ],
        },
      ],
    },
    {
      id: "area-execute",
      displayId: "A2",
      title: "Execute the work",
      summary: "Running tasks autonomously and recording what they cost.",
      stewards: ["Ryan Keith"],
      capabilities: [
        {
          id: "cap-autonomous-runs",
          displayId: "A2.1",
          title: "Autonomous task runs",
          statement: "An agent picks the next actionable task and implements it unattended.",
          // Both signals at once: the spec moved ahead of the build *and* what
          // was built is broken. The Product page must mark this row.
          status: "revised",
          health: "defective",
          specReviewed: false,
          criteriaCount: 4,
          openChanges: [
            {
              id: "change-run-field",
              displayId: "CH-160",
              title: "A run field on PRD items",
              stage: "ready",
              delta: "modified",
            },
            {
              id: "change-forked-sessions",
              displayId: "CH-161",
              title: "Forked sessions recover from read-only refusal",
              stage: "in-progress",
            },
          ],
        },
        {
          id: "cap-token-accounting",
          displayId: "A2.2",
          title: "Per-task token accounting",
          statement: "Every run's token spend is attributed to the item it was for.",
          status: "met",
          health: "defective",
          specReviewed: true,
          criteriaCount: 2,
          openChanges: [
            {
              id: "change-usage-cursors",
              displayId: "CH-158",
              title: "Fix usage-cursor drift across forked sessions",
              stage: "ready",
              delta: "modified",
            },
          ],
        },
        {
          id: "cap-epic-by-epic",
          displayId: "A2.3",
          title: "Epic-by-epic sequencing",
          statement: "Epics are processed in order rather than by global priority.",
          status: "retired",
          health: "ok",
          specReviewed: true,
          criteriaCount: 1,
          openChanges: [],
        },
      ],
    },
  ],
  constraints: [
    {
      id: "constraint-architecture-integrity",
      displayId: "A0.1",
      title: "Architecture integrity",
      statement: "Cross-package imports pass through a gateway module; no zone cycles.",
      health: "ok",
      appliesTo: "all",
    },
    {
      id: "constraint-cross-os",
      displayId: "A0.2",
      title: "Cross-OS parity",
      statement: "Every command behaves the same on Windows, macOS and Linux.",
      health: "defective",
      appliesTo: ["Autonomous task runs", "Per-task token accounting"],
    },
  ],
};

export const CHANGES_FIXTURE: ChangeRow[] = [
  {
    id: "change-placement-engine",
    displayId: "CH-142",
    title: "Placement engine for changes",
    intent: "A captured change finds its own place on the map instead of waiting for triage.",
    stage: "in-progress",
    priority: "high",
    loe: 2,
    assignee: "Sterling H",
    plannedRelease: "1.0.0",
    amends: [{ id: "cap-placement", title: "Automatic placement", delta: "modified" }],
    touches: [],
    taskCount: 4,
    completedTaskCount: 1,
  },
  {
    id: "change-stewards",
    displayId: "CH-151",
    title: "Stewards and code-owner files",
    intent: "Each area names a steward, and the steward's review gates the spec.",
    stage: "proposed",
    priority: "medium",
    plannedRelease: "1.0.0",
    needsPlacement: true,
    amends: [{ id: "cap-spec-review", title: "Steward spec review", delta: "added" }],
    touches: [],
    taskCount: 0,
    completedTaskCount: 0,
  },
  {
    id: "change-run-field",
    displayId: "CH-160",
    title: "A run field on PRD items",
    intent: "Run settings travel with the task rather than with the invocation.",
    stage: "ready",
    priority: "high",
    loe: 1,
    plannedRelease: "0.9.0",
    amends: [{ id: "cap-autonomous-runs", title: "Autonomous task runs", delta: "modified" }],
    touches: [],
    taskCount: 3,
    completedTaskCount: 0,
  },
  {
    id: "change-usage-cursors",
    displayId: "CH-158",
    title: "Fix usage-cursor drift across forked sessions",
    intent: "A forked session must not re-attribute tokens the parent already claimed.",
    stage: "ready",
    priority: "medium",
    plannedRelease: "0.9.0",
    amends: [{ id: "cap-token-accounting", title: "Per-task token accounting", delta: "modified" }],
    touches: [],
    taskCount: 2,
    completedTaskCount: 1,
  },
  {
    id: "change-jev-client",
    displayId: "CH-139",
    title: "Move the Jev client into llm-client",
    intent: "One client, one place to redact credentials.",
    stage: "shipped",
    priority: "medium",
    plannedRelease: "0.9.0",
    shippedIn: "0.9.0",
    amends: [],
    touches: [{ id: "constraint-architecture-integrity", title: "Architecture integrity" }],
    taskCount: 2,
    completedTaskCount: 2,
  },
  {
    id: "change-windows-ports",
    displayId: "CH-133",
    title: "Windows near-port relocation never engages",
    intent: "The dashboard must find a free port on Windows the way it does elsewhere.",
    stage: "applied",
    priority: "low",
    plannedRelease: "0.9.0",
    amends: [{ id: "constraint-cross-os", title: "Cross-OS parity", delta: "modified" }],
    touches: [],
    taskCount: 1,
    completedTaskCount: 1,
  },
  {
    id: "change-forked-sessions",
    displayId: "CH-161",
    title: "Forked sessions recover from read-only refusal",
    intent: "A read-only refusal mid-run should retry, not end the run.",
    stage: "in-progress",
    priority: "high",
    spike: true,
    amends: [],
    touches: [{ id: "cap-autonomous-runs", title: "Autonomous task runs" }],
    taskCount: 1,
    completedTaskCount: 0,
  },
  {
    id: "change-timeline",
    displayId: "CH-170",
    title: "Time-ordered change timeline",
    intent: "See what shipped when, across releases.",
    stage: "proposed",
    priority: "low",
    needsPlacement: true,
    amends: [],
    touches: [],
    taskCount: 0,
    completedTaskCount: 0,
  },
];

export const CAPABILITY_DETAIL_FIXTURE: CapabilityDetail = {
  id: "cap-autonomous-runs",
  displayId: "A2.1",
  title: "Autonomous task runs",
  statement: "An agent picks the next actionable task and implements it unattended.",
  status: "revised",
  health: "defective",
  specReviewed: false,
  criteriaCount: 4,
  areaId: "area-execute",
  areaTitle: "Execute the work",
  openChanges: [
    {
      id: "change-run-field",
      displayId: "CH-160",
      title: "A run field on PRD items",
      stage: "ready",
      delta: "modified",
    },
    {
      id: "change-forked-sessions",
      displayId: "CH-161",
      title: "Forked sessions recover from read-only refusal",
      stage: "in-progress",
    },
  ],
  criteria: [
    { id: "c1", text: "The agent selects a task without being told which one." },
    { id: "c2", text: "A failing validation run ends the task rather than committing." },
    { id: "c3", text: "The run is recorded with its token spend." },
    {
      id: "c4",
      text: "Every command behaves the same on Windows, macOS and Linux.",
      inheritedFrom: "Cross-OS parity",
    },
  ],
  dependsOn: [
    { id: "cap-token-accounting", title: "Per-task token accounting" },
    { id: "cap-placement", title: "Automatic placement" },
  ],
  history: [
    {
      changeId: "change-autonomous-loop",
      changeDisplayId: "CH-088",
      changeTitle: "Autonomous loop over the PRD",
      stage: "shipped",
      delta: "added",
      shippedIn: "0.7.0",
      at: "2026-05-11",
    },
    {
      changeId: "change-review-pass",
      changeDisplayId: "CH-112",
      changeTitle: "Adversarial review pass after each task",
      stage: "shipped",
      delta: "modified",
      shippedIn: "0.8.0",
      at: "2026-08-02",
    },
    {
      changeId: "change-forked-sessions",
      changeDisplayId: "CH-161",
      changeTitle: "Forked sessions recover from read-only refusal",
      stage: "in-progress",
    },
  ],
  code: [
    { path: "packages/hench/src/cli/commands/run.ts", role: "entry point" },
    { path: "packages/hench/src/agent/loop.ts", role: "agent loop" },
    { path: "packages/hench/tests/integration/run-loop.test.ts", role: "tests" },
  ],
};

/** A map with nothing in it, for the Product page's empty state. */
export const EMPTY_PRODUCT_MAP_FIXTURE: ProductMap = { areas: [], constraints: [] };
