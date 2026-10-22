/**
 * On-page step captions, so the recorded video narrates itself.
 *
 * Playwright's `test.step` shows in the trace and report but not in the
 * video; this draws the same text as a fixed banner inside the page. A
 * navigation wipes it, so call it again after `goto`.
 */

import { test, type Page } from "@playwright/test";

const CAPTION_ID = "ndx-e2e-caption";

export async function caption(page: Page, text: string): Promise<void> {
  await test.step(text, async () => {
    await page.evaluate(
      ({ id, text }) => {
        let el = document.getElementById(id);
        if (!el) {
          el = document.createElement("div");
          el.id = id;
          el.setAttribute("aria-hidden", "true");
          Object.assign(el.style, {
            position: "fixed",
            top: "8px",
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: "2147483647",
            pointerEvents: "none",
            padding: "6px 14px",
            borderRadius: "6px",
            background: "rgba(20,20,20,0.85)",
            color: "#fff",
            font: "600 14px system-ui, sans-serif",
            maxWidth: "80vw",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          });
          document.body.appendChild(el);
        }
        el.textContent = text;
      },
      { id: CAPTION_ID, text },
    );
  });
}
