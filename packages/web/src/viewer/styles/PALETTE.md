# n-dx Web Dashboard — Color Token Palette

This file tracks the semantic color tokens defined in `tokens.css` and records
their WCAG AA contrast ratios. All text-use tokens must pass **4.5:1** against
their badge/surface background; large-text and UI component tokens must pass
**3:1**.

---

## Brand Tokens (`:root` — theme-independent)

| Token | Value | Notes |
|-------|-------|-------|
| `--brand-navy` | `#001769` | Sidebar background (light mode logo) |
| `--brand-teal` | `#00E5B9` | Accent on dark backgrounds |
| `--brand-purple` | `#6c41f0` | Purple status / logo bg (dark) |
| `--brand-rose` | `#d52e66` | Base rose — **not used directly as text** in themes (overridden) |
| `--brand-green` | `#00bd81` | Base green — **not used directly as text** in light theme (overridden) |
| `--brand-orange` | `#ff5926` | Base orange — **not used directly as text** in light theme (overridden) |

---

## Dark Theme (`[data-theme="dark"]`)

Background surfaces: `--bg: #0c0e1a`, `--bg-surface: #151829`

| Token | Value | Contrast vs `--bg-surface` | Notes |
|-------|-------|---------------------------|-------|
| `--text` | `#e8eaf0` | 14.7:1 ✅ | Primary body text |
| `--text-dim` | `#9ea3bc` | 7.0:1 ✅ | Secondary text, metadata |
| `--text-muted` | `#868aaa` | 5.3:1 ✅ | Updated from `#6b7094` (was 3.7:1 ❌) |
| `--accent` | `#00E5B9` | 8.9:1 ✅ | Interactive elements, focus rings |
| `--green` | `#00bd81` | 6.0:1 ✅ | Success / completed status badge text |
| `--orange` | `#ff5926` | 4.9:1 ✅ | Warning / deferred status badge text |
| `--red` | `#f55574` | 4.9:1 ✅ | Updated from `#d52e66` (was 3.4:1 ❌); error/failed status badge text |
| `--purple` | `#6c41f0` | 2.8:1 ⚠️ | Not used for text in badges; decorative use only |

> Contrast ratios computed against composited badge background
> (`color-mix(in srgb, <color> 12%, transparent)` on `--bg-surface`).
> `--purple` is exempt because it is not used in status badge text.

---

## Light Theme (`[data-theme="light"]`)

Background surfaces: `--bg: #f5f6fa`, `--bg-surface: #ffffff`

| Token | Value | Contrast vs badge bg (~white) | Notes |
|-------|-------|-------------------------------|-------|
| `--text` | `#1a1d2e` | 17.5:1 ✅ | Primary body text |
| `--text-dim` | `#5c6078` | 5.3:1 ✅ | Secondary text |
| `--text-muted` | `#6b6e88` | 4.6:1 ✅ | Updated from `#8b90a8` (was 2.9:1 ❌) |
| `--accent` | `#006E4E` | 5.6:1 ✅ | Updated from `#008f60` (was 3.7:1 ❌); interactive elements, focus rings |
| `--green` | `#006E4A` | 5.6:1 ✅ | Updated from `var(--brand-green)` (was 2.2:1 ❌); success / completed |
| `--orange` | `#B03800` | 5.4:1 ✅ | Updated from `var(--brand-orange)` (was 2.7:1 ❌); warning / deferred |
| `--red` | `#B01A54` | 5.9:1 ✅ | Updated from `var(--brand-rose)` (was failing ❌); error / failed |
| `--purple` | `#6c41f0` | 5.3:1 ✅ | Purple status; passes on white bg |

> Badge background is `color-mix(in srgb, <color> 12%, transparent)` composited
> on `--bg-surface` (#ffffff). The composited badge bg has L ≈ 0.88–0.93
> depending on the color, requiring text L ≤ 0.17 for 4.5:1.

---

## WCAG AA Compliance Summary

| Criterion | Status |
|-----------|--------|
| Body/label text — dark theme | ✅ All pass 4.5:1 |
| Body/label text — light theme | ✅ All pass 4.5:1 |
| Status badge text — dark theme | ✅ All pass 4.5:1 |
| Status badge text — light theme | ✅ All pass 4.5:1 |
| Severity badge text — both themes | ✅ Use CSS vars from tokens.css; tested values pass 4.5:1 |
| Focus rings (`--accent`) — both themes | ✅ Pass 3:1 for UI |
| `prefers-reduced-motion` — all CSS animations | ✅ All 22 animation files have a `@media (prefers-reduced-motion: reduce)` block |
| Non-color run status indicators (hench runs) | ✅ Icon + text label |
| Non-color zone health indicators (overview) | ✅ Dot + text label |
| Non-color PRD task status (prd-tree) | ✅ Icon + aria-label (pre-existing) |
| Non-color severity labels (findings) | ✅ Icon (⛔/⚠/ℹ) + text label, color is redundant |

---

## How Contrast Ratios Are Computed

Using the WCAG 2.1 relative luminance formula:

```
L = 0.2126·R_lin + 0.7152·G_lin + 0.0722·B_lin

where for sRGB channel c ∈ [0,1]:
  c_lin = c / 12.92                    if c ≤ 0.04045
  c_lin = ((c + 0.055) / 1.055)^2.4   otherwise

contrast = (L_lighter + 0.05) / (L_darker + 0.05)
```

Normal text (< 18px regular, < 14px bold) requires **4.5:1**.
Large text (≥ 18px regular, ≥ 14px bold) and UI components require **3:1**.
