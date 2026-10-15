---
"@n-dx/web": patch
---

Icon-only action buttons in the dashboard draw a shared SVG icon sized by one token (16px) instead of a Unicode glyph sized by each button's font. The Next Steps copy button (`⎘`, which rendered a few pixels tall) shows a copy icon that turns into a check once copied, with a 28px click target, and the close (`✕`/`×`) and more (`⋯`) buttons across the viewer use the same icon set.
