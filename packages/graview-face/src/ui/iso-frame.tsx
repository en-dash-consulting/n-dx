/**
 * SOURCEVISION'S ISOMETRIC MAP, FRAMED. `ndx graview emit` writes the map in
 * embed mode beside the snapshot and the door serves it at
 * `/data/iso-map.html`; this frames it and speaks its embed contract
 * (`{ type: "ndx-iso", … }` by postMessage): the face's scheme, wheel zoom
 * when the map has the page to itself, and the zone to select. A project
 * sourcevision has not analyzed has no map, and the frame says how to make one.
 */
import { useEffect, useRef, useState } from "react";
import { BASE } from "../base.js";
import { Empty } from "./kit.js";

export const ISO_MAP_URL = `${BASE}/data/iso-map.html`;
/** The door marks the map it serves, so a host's page-not-found fallback is never framed as one. */
export const ISO_MAP_HEADER = "x-ndx-iso-map";
/** The map's own root element in embed mode (sourcevision's renderIsoMap). */
const ISO_MAP_ROOT = '<html lang="en" class="embed">';

type Availability = "checking" | "yes" | "no";

/**
 * Whether the URL answers with the map. A single-page host (Vite's dev server,
 * `vite preview`, most static hosts) answers a missing file with the face's own
 * index.html, 200 and text/html, so the content type alone would frame the face
 * inside itself. The door says so in a header; any other host is read for the
 * map's root element.
 */
async function servesMap(): Promise<boolean> {
  const head = await fetch(ISO_MAP_URL, { method: "HEAD", cache: "no-store" });
  if (!head.ok) return false;
  if (head.headers.get(ISO_MAP_HEADER) === "1") return true;
  if (!(head.headers.get("content-type") ?? "").includes("text/html")) return false;
  const page = await fetch(ISO_MAP_URL, { cache: "no-store" });
  return page.ok && (await page.text()).includes(ISO_MAP_ROOT);
}

/** Whether there is a map to frame, asked once per page. */
function useIsoMap(): Availability {
  const [state, setState] = useState<Availability>("checking");
  useEffect(() => {
    let live = true;
    servesMap()
      .then((yes) => live && setState(yes ? "yes" : "no"))
      .catch(() => live && setState("no"));
    return () => {
      live = false;
    };
  }, []);
  return state;
}

const scheme = (): "light" | "dark" => (document.documentElement.dataset["graviewScheme"] === "dark" ? "dark" : "light");

export function IsoFrame({ focus, height, wheelZoom = false, title }: { focus?: string; height: string; wheelZoom?: boolean; title: string }) {
  const available = useIsoMap();
  const frame = useRef<HTMLIFrameElement | null>(null);
  const [loaded, setLoaded] = useState(false);

  // Say the scheme, the zoom and the focus once the map has loaded, and the scheme again whenever the face changes it.
  useEffect(() => {
    const target = frame.current?.contentWindow;
    if (!loaded || !target) return;
    // The frame is sandboxed, so its origin is opaque and only "*" reaches it; the message says nothing private.
    const say = () => target.postMessage({ type: "ndx-iso", theme: scheme(), wheelZoom, ...(focus ? { focus } : {}) }, "*");
    say();
    const watch = new MutationObserver(() => target.postMessage({ type: "ndx-iso", theme: scheme() }, "*"));
    watch.observe(document.documentElement, { attributes: true, attributeFilter: ["data-graview-scheme"] });
    return () => watch.disconnect();
  }, [loaded, focus, wheelZoom]);

  if (available === "no") return <Empty command="ndx analyze .">No code map yet: sourcevision has not analyzed this project, or the projection was emitted before it did.</Empty>;
  if (available === "checking") return <div className="ndx-iso" style={{ height }} aria-busy="true" />;
  // Scripts only: the map runs its own, but in an opaque origin it cannot read this page's door key or call the door.
  return <iframe ref={frame} className="ndx-iso" sandbox="allow-scripts" src={ISO_MAP_URL} title={title} style={{ height }} onLoad={() => setLoaded(true)} />;
}
