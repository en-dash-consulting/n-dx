# Animation Frame Audit — Rex-F.png vs Current Frames

Produced: 2026-04-09  
Auditor: hench agent  
Scope: `packages/core/cli-brand.js` — `DINO_BODY_PIXELS`, `DINO_LEGS[0..1]`, `QUADRANT_LEGS[0..1]`

---

## Reference Images

| File | Role |
|------|------|
| `packages/rex/Rex-F.png` | **Canonical first frame** — both feet planted, double-support stance |
| `packages/rex/Rex.png` | **Stride-phase reference** — slight stride variant, used for Frame 1 |

---

## Colour Palette Observation

The current palette (`FG`/`BG` in `cli-brand.js`) covers three values:

| Value | ANSI | Visual |
|-------|------|--------|
| 1 | `38;2;180;80;255` / `48;2;180;80;255` | Bright purple (body) |
| 2 | `38;2;100;30;160` / `48;2;100;30;160` | Dark purple (outline/shadow) |
| 3 | `38;2;255;255;255` | White (eye) |

**Divergence:** Both reference images show a distinct **cyan/teal** colour at the feet and ground-line area. No cyan exists in the current palette. This affects both leg frames identically — a pixel-value 4 (or equivalent) would be needed to represent it. Impact: **cosmetic, low priority** relative to structural issues below.

---

## Body Frame — DINO_BODY_PIXELS (static, all frames)

```
000000002222222200000000   row 0  — head top outline (cols 8–15)
000000021111111120000000   row 1  — head interior
000000021113111120000000   row 2  — head interior + eye at col 10
000000021111111120000000   row 3  — head interior
000000021111111112000000   row 4  — neck / upper-right transition
000000022111111120000000   row 5  — neck
000000002211111200000000   row 6  — upper body
000000002111111200000000   row 7  — upper body
022000021111111120000000   row 8  — forelimb stub (cols 1–2) + body
021110211111111120000000   row 9  — forelimb
002112111111111120000000   row 10 — forelimb tip
000211111111111120000000   row 11 — lower body / hip
000021111111111200000000   row 12 — lower body
000002111111111000000000   row 13 — tail base
000000211111120000000000   row 14 — tail mid
000000021111200000000000   row 15 — tail tip
```

### Against Rex-F.png

| Feature | Rex-F.png | Current pixels | Assessment |
|---------|-----------|----------------|------------|
| Head position | Right side of frame, large block | Cols 7–15, rows 0–4 | **Match** |
| Eye | Upper-third of head, single pixel | Row 2 col 10 (value 3) | **Match** — plausible position |
| Neck narrowing | Visible step inward at neck | Row 5–6 step from 2→1 column | **Match** |
| Forelimb / tiny arm | Small protrusion mid-left of body | Rows 8–10, cols 1–2 | **Match** — stub visible |
| Tail | Extends left and downward | Rows 13–15, diagonal col 5→7 | **Approximate match** — tail tip may be 1–2 pixels too short horizontally |
| Overall silhouette | T-Rex stance, head right, tail left | As above | **Acceptable** |

**Verdict:** Body frame is a reasonable match to Rex-F.png. No redraw required; tail-tip extension (row 14–15) is a candidate for minor adjustment.

---

## Leg Frame 0 — DINO_LEGS[0] (reference: Rex-F.png)

```
000000021000002100000000   row 16 — upper legs
000000021100002110000000   row 17 — lower legs / feet
```

### Pixel interpretation (combined with body rows 15–16 using `halfBlock`)

| Column range | Top pixel | Bottom pixel | Rendered glyph | Meaning |
|---|---|---|---|---|
| col 7 | 1 | 1 | █ (bright purple solid) | Left leg shaft |
| col 8 | 0 | 1 | ▄ (purple bottom-half) | Left foot touching ground |
| col 14 | 1 | 1 | █ | Right leg shaft |
| col 15 | 0 | 1 | ▄ | Right foot touching ground |

Both feet land on the bottom edge of their cells — double-support stance.

### Against Rex-F.png

| Feature | Rex-F.png | Current | Assessment |
|---------|-----------|---------|------------|
| Both feet planted | ✓ | ✓ | **Match** |
| Foot position (▄) | Ground level | Row 17 bottom half | **Match** |
| Leg spacing | ~6–7 cols apart | Cols 7 and 14 = 7 apart | **Match** |
| Cyan foot colour | ✓ visible at base | ✗ purple only | **Divergence** — cosmetic |

**Verdict:** Frame 0 is structurally correct. Only the missing cyan foot colour is a divergence. **Minor adjustment only.**

---

## Leg Frame 1 — DINO_LEGS[1] (reference: Rex.png)

```
000000021000002100000000   row 16   ← IDENTICAL to Frame 0
000000021100002110000000   row 17   ← IDENTICAL to Frame 0
```

### Critical finding

**DINO_LEGS[0] and DINO_LEGS[1] are pixel-for-pixel identical.**  
There is no animation change between Frame 0 and Frame 1 in the true-colour path.

Rex.png shows a distinctly different leg configuration from Rex-F.png — a stride pose where one leg is pushed forward/back relative to the other, or one foot is lifted slightly. The current Frame 1 fails to encode any of that difference.

### Required changes (redraw)

The exact pixel layout depends on reading Rex.png anatomy precisely. A stride cycle typically shifts one leg forward and one back, e.g.:

```
Candidate Frame 1 (right leg shifted one column right, left leg same):
row 16: 000000021000001200000000   left leg shaft + right leg at col 13 (outline)
row 17: 000000021100001220000000   left foot + right leg tip

Or (left leg lifted — upper pixel only):
row 16: 000000002100002100000000   left leg top-only (▀), right leg solid
row 17: 000000000000002110000000   no left foot pixel, right foot planted
```

The specific correct layout must be derived from Rex.png pixel grid, not guessed. **Requires redraw.**

**Verdict:** Frame 1 requires redrawing. Priority: **high** — without it the animation is static.

---

## QUADRANT_LEGS[0] — monochrome fallback Frame 0

```
"      █     █"
```

Six spaces + solid block, five spaces + solid block.  
Represents double-support stance.

### Against Rex-F.png

| Feature | Rex-F.png | Current | Assessment |
|---------|-----------|---------|------------|
| Both legs as solid columns | ✓ | █ █ | **Match** |
| Leg spacing | ~6 chars | cols 6 and 12 | **Match** |
| Foot width | 1 px each | 1 char each | **Match** |

**Verdict:** Frame 0 monochrome is correct. No changes needed.

---

## QUADRANT_LEGS[1] — monochrome fallback Frame 1

```
"      █     ▐▌"
```

Left leg: `█` (solid, 1 char wide)  
Right leg: `▐▌` (two characters — RIGHT HALF BLOCK + LEFT HALF BLOCK)

### Issues

1. **Width mismatch:** The right leg occupies two character columns (`▐▌`) while the left leg occupies one (`█`). This shifts all text to the right of the right leg by one column, creating a width inconsistency between Frame 0 and Frame 1. Terminal animation that cycles between frames will cause a visible one-column jump.

2. **Semantic mismatch:** `▐▌` side-by-side renders as two adjacent half-filled columns — this does not clearly convey a lifted or striding foot. A single `▌` or `▟` would be more legible and width-consistent.

**Verdict:** Frame 1 monochrome requires adjustment. Priority: **medium** — fix `▐▌` → single-character stride glyph, and ensure total string length matches Frame 0.

---

## Summary Table

| Frame | Path | Status | Priority | Issue |
|-------|------|--------|----------|-------|
| Body (static) | `DINO_BODY_PIXELS` | Minor adjustment | Low | Tail tip 1–2 px short |
| Frame 0 legs (true-colour) | `DINO_LEGS[0]` | Minor adjustment | Low | Missing cyan foot colour |
| Frame 1 legs (true-colour) | `DINO_LEGS[1]` | **Redraw required** | **High** | Identical to Frame 0 — no animation |
| Frame 0 legs (monochrome) | `QUADRANT_LEGS[0]` | Correct | — | No action needed |
| Frame 1 legs (monochrome) | `QUADRANT_LEGS[1]` | Minor adjustment | Medium | `▐▌` is 2 chars wide; width inconsistency |

---

## Recommended Correction Order

1. **Redraw `DINO_LEGS[1]`** from Rex.png anatomy — this is the only change that restores actual animation.
2. **Fix `QUADRANT_LEGS[1]`** `▐▌` → single stride glyph to prevent frame-width jump.
3. (Optional) Add cyan as palette value 4 and apply to foot pixels in both leg frames.
4. (Optional) Extend tail tip in `DINO_BODY_PIXELS` by 1–2 pixels.
