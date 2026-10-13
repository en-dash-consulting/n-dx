/**
 * The way over to the product map: a link to the running Graview face, which
 * opens in its own tab. With `features.graview.productFace` on and no face
 * running it offers to start one; with the flag off and no face, it is absent.
 */
import { h } from "preact";
import { useCliName, useGraviewFace } from "../hooks/index.js";

export function ProductMapLink({ enabled }: { enabled: boolean }) {
  const { state, start } = useGraviewFace(enabled);
  const cli = useCliName();
  if (!enabled || !state) return null;
  if (state.face) {
    return h("a", {
      class: "topnav-map",
      href: state.face.url,
      target: "_blank",
      rel: "noopener",
      "aria-label": "Product map (opens in a new tab)",
      title: `The product map, at ${state.face.url}`,
    },
      h("span", { class: "topnav-tab-glyph", "aria-hidden": "true" }, "◇"),
      h("span", { class: "topnav-map-label" }, "Product map"),
      h("span", { class: "topnav-map-out", "aria-hidden": "true" }, "↗"),
    );
  }
  if (!state.enabled) return null;
  if (state.starting) {
    return h("span", { class: "topnav-map topnav-map--quiet", role: "status" },
      h("span", { class: "topnav-tab-glyph", "aria-hidden": "true" }, "◇"),
      h("span", { class: "topnav-map-label" }, "Starting map…"),
    );
  }
  return h("button", {
    type: "button",
    class: "topnav-map topnav-map--quiet",
    onClick: () => { void start(); },
    title: state.error ? `The last start failed: ${state.error}` : `Start the product map (${cli} graview serve)`,
  },
    h("span", { class: "topnav-tab-glyph", "aria-hidden": "true" }, "◇"),
    h("span", { class: "topnav-map-label" }, state.error ? "Map failed, retry" : "Start map"),
  );
}
