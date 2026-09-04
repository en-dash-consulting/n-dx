# Accessibility (a11y)

The n-dx web dashboard targets **WCAG 2.1 AA** compliance. This document covers supported assistive technologies, known limitations, automated regression tests, and the manual verification procedure.

## Supported Assistive Technologies

| Technology | Browser | Support level |
|-----------|---------|---------------|
| NVDA (latest) | Chrome | Primary — tested on each release |
| VoiceOver (macOS 14+) | Safari | Primary — tested on each release |
| VoiceOver (iOS 17+) | Safari Mobile | Secondary — spot-checked |
| JAWS (latest) | Chrome / Edge | Secondary — compatibility only |
| Keyboard navigation | Any | Full — all interactive controls are keyboard-accessible |

## Known Limitations

### Graph views (Zones, Import Graph)

The architectural zone diagram and import-graph views render as interactive SVG canvases driven by a D3 force layout. SVG nodes are keyboard-focusable and labelled, but reading every node-and-edge individually via a screen reader is impractical for large codebases.

**Recommended workaround:** Switch to the **table view** fallback available in each view:

- **Zones view** — the collapsible zone list below the SVG canvas provides full zone name, file count, cohesion, and coupling data in a scrollable `<ul>` with keyboard-navigable items.
- **Import Graph view** — the "File list" panel (right column) lists every file with its import count, most-imported packages, and circular-dependency flags in a standard HTML table.

All data displayed in the SVG canvas is fully accessible through these table/list alternatives. The SVG canvas itself is marked `aria-hidden="true"` and is supplementary.

### Color contrast in jsdom tests

Automated axe-core tests run in jsdom, which does not compute CSS `getComputedStyle` values. The `color-contrast` axe rule is therefore **disabled** in automated tests. Contrast must be verified manually using the procedure below.

The dashboard uses CSS custom properties (`--color-*`) for all text and background colors. Contrast ratios must be verified against both light and dark theme values defined in `packages/web/src/viewer/styles/themes.css`.

## Automated Regression Tests

Axe-core integration tests run against every major dashboard route as part of the standard Vitest suite:

```
packages/web/tests/unit/viewer/axe-audit.test.ts
```

**Routes covered:**

| Route / Component | Test description |
|-------------------|-----------------|
| Rex PRD Tree (`prd`) | PRDTree with mock epic/feature hierarchy |
| Findings / Problems (`problems`) | FindingsList with critical + warning findings |
| ProblemsView | Locked (insufficient data) and populated states |
| Import Graph (`graph`) | Graph view with two-node mock |
| Zones (`zones`, `architecture`) | ZonesView with two-zone mock |
| Overview | OverviewView with full LoadedData fixture |
| Hench Monitor (`hench-runs`) | HenchRunsView loading state |
| Hench Config (`hench-config`) | HenchConfigView loading state |
| PR Tab (`pr-markdown`) | PRMarkdownView loading state |
| Ask (`ask`) | AskView idle state, plus the deployed-mode unavailable state |
| Settings (`project-settings`) | ProjectSettingsView loading state |

Each route is tested in **both light and dark themes** to catch theme-specific structural regressions (missing ARIA labels that only appear in one theme, dynamic class applications, etc.).

### Behavioural a11y suites

Axe checks static structure. Behaviour that only exists across a state
transition — live-region announcement, focus retention, non-colour state
signalling — is covered by dedicated suites alongside it:

| Suite | Covers |
|-------|--------|
| `tests/unit/viewer/findings-list-a11y.test.ts` | List semantics, labelled filters, result-count live region, severity by text |
| `tests/unit/viewer/a11y-semantic-html.test.ts` | Native controls over `div[role=button]`, dialog focus trap and restore, skip link |
| `tests/unit/viewer/ask-view-a11y.test.ts` | Async answer arrival: persistent live region (asserted by node identity), focus retained across the submit cycle, outcome marked by shape as well as hue |

The Ask panel is the one view whose result arrives after an indeterminate
delay, so its announcement is a functional requirement rather than a polish
item — see the "Accessibility" section of
`packages/web/src/viewer/views/ask.ts` for the reasoning behind each choice.

### CI gate

Tests fail if any axe violation with impact `critical` or `serious` is introduced. Violations at `moderate` or `minor` impact are reported but do not block CI.

Disabled rules (require real browser rendering, not jsdom):
- `color-contrast` — needs computed CSS styles
- `region` — page-level landmark rules not applicable to component fragments
- `landmark-one-main` — component fragments, not full pages
- `page-has-heading-one` — component fragments
- `bypass` — skip-link rule, applied at app-shell level

### Running axe tests independently

```sh
# Run only the [a11y] tagged test suites in the web package
pnpm --filter @n-dx/web run test:a11y

# Or from project root (runs all axe-audit tests)
pnpm test -- --testNamePattern "\[a11y\]"
```

### Setup requirement

axe-core must be installed before the tests will run. It is declared as a `devDependency` in `packages/web/package.json`. Run `pnpm install` from the project root to install it. When axe-core is absent, all `[a11y]` tests are skipped (not failed) so CI still passes with a warning.

## Manual Screen-Reader Test Procedure

Run this procedure before any release that touches dashboard UI components.

### Prerequisites

1. Install NVDA (Windows) or use built-in VoiceOver (macOS/iOS).
2. Start the n-dx dashboard: `ndx start .`
3. Open `http://localhost:3117` in the target browser.

### Checklist

#### Keyboard navigation (any browser)

- [ ] Tab through the sidebar navigation — each item is focusable and announces its label.
- [ ] Enter/Space on a sidebar item navigates to the correct view.
- [ ] The skip-link (`Skip to main content`) is reachable as the first Tab stop on page load and jumps focus to `#main-content`.
- [ ] All modal dialogs (Guide, Zone details slideout, Add Item form) trap focus while open and restore focus to the trigger element on close.
- [ ] Status filter chips (PRD view) are navigable with Arrow Left / Right.
- [ ] PRD tree items are navigable with Arrow Up / Down.

#### NVDA + Chrome (Windows)

1. Open the dashboard. NVDA should announce the page landmark structure (navigation, main).
2. Navigate to **PRD view** — verify NVDA announces each epic/feature/task title and status.
3. Expand an epic — verify NVDA announces `expanded` / `collapsed` state.
4. Navigate to **Zones view** — verify the zone table list below the graph is reachable and reads zone names + metrics.
5. Navigate to **Findings view** — verify severity badges are announced by text label (not just color).
6. Navigate to **Hench Runs view** — verify that arriving task progress updates (via ARIA live region) are announced.

#### VoiceOver + Safari (macOS)

1. Enable VoiceOver (`⌘ F5`). Open the dashboard.
2. Use `VO + Right` to navigate through the sidebar — each item should be announced.
3. Navigate to **PRD view** — use VoiceOver rotor (`VO + U`) → Tables to jump to the PRD tree.
4. Use VoiceOver's Form Controls rotor to navigate all form elements in **Hench Config** and **Project Settings** — each must have a label.
5. Open the **Guide modal** on any view — VoiceOver should announce `dialog` and move focus inside. Escape should close and restore focus.
6. Navigate to **Zones view** — use VoiceOver's Links/Headings rotor to confirm section structure is logical.

### Reporting findings

File accessibility bugs with label `a11y` in the issue tracker. Include:
- View / component name
- Assistive technology and version
- Browser and OS
- Steps to reproduce
- Expected vs. actual announcement

## Color Contrast Verification

Contrast ratios must meet WCAG 2.1 AA minimums:
- Normal text (< 18pt): **4.5:1**
- Large text (≥ 18pt or ≥ 14pt bold): **3:1**
- UI components / graphical objects: **3:1**

### Manual verification steps

1. Open `packages/web/src/viewer/styles/themes.css`.
2. For each text-on-background pair, use [WebAIM Contrast Checker](https://webaim.org/resources/contrastchecker/) or the browser's DevTools accessibility panel.
3. Test in both light (`data-theme="light"`) and dark (`data-theme="dark"`) themes — toggle via the sidebar theme button.

### Key color pairs to check (both themes)

| Element | CSS variable (text) | CSS variable (background) |
|---------|--------------------|-----------------------------|
| Body text | `--color-text` | `--color-bg` |
| Sidebar labels | `--color-sidebar-text` | `--color-sidebar-bg` |
| Status chips (active) | `--color-chip-text` | `--color-chip-bg-active` |
| Severity badge (critical) | `--color-critical-text` | `--color-critical-bg` |
| Severity badge (warning) | `--color-warning-text` | `--color-warning-bg` |
| Link text | `--color-link` | `--color-bg` |

## Table-View Fallback for Graph Views

All data displayed in SVG/canvas graph views is available through a linear HTML alternative:

| View | Graph element | HTML fallback |
|------|-------------|---------------|
| Zones (`/graph`, `/architecture`) | SVG zone boxes and Bézier edges | Zone cards list (below the SVG canvas) — `<ul>` with zone name, cohesion, coupling, file count |
| Import Graph (`/graph` file mode) | Force-directed node graph | File list panel — `<table>` with path, import count, external packages |
| Merge Graph (`/merge-graph`) | D3 merge history graph | Commit list — `<ol>` with commit hash, message, date |

These fallbacks satisfy [WCAG 2.1 Success Criterion 1.1.1](https://www.w3.org/WAI/WCAG21/Understanding/non-text-content.html) (Non-text Content) and [4.1.2](https://www.w3.org/WAI/WCAG21/Understanding/name-role-value.html) (Name, Role, Value).

SVG canvases are supplementary visual representations; all information is equally available in the list/table fallbacks. When a user navigates the page with a screen reader, the SVG canvas is marked `aria-hidden="true"` and focus is directed to the list/table fallback via a visible `<a>` link above the canvas with the text "View as table".
