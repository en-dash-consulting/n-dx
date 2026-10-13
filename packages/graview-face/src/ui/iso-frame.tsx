/**
 * SOURCEVISION'S ISOMETRIC MAP, FRAMED. `ndx graview emit` writes the map in
 * embed mode beside the snapshot and the door serves it at
 * `/data/iso-map.html`; this frames it and speaks its embed contract
 * (`{ type: "ndx-iso", … }` by postMessage): the face's scheme, wheel zoom
 * when the map has the page to itself, and the zone to select. A project
 * sourcevision has not analyzed has no map, and the frame says how to make one.
 */
import { useEffect, useRef, useState } from "react";
import { Empty } from "./kit.js";

export const ISO_MAP_URL = "/data/iso-map.html";

type Availability = "checking" | "yes" | "no";

/** Whether the door has a map to serve, asked once per page. */
function useIsoMap(): Availability {
  const [state, setState] = useState<Availability>("checking");
  useEffect(() => {
    let live = true;
    fetch(ISO_MAP_URL, { method: "HEAD", cache: "no-store" })
      .then((r) => live && setState(r.ok && (r.headers.get("content-type") ?? "").includes("text/html") ? "yes" : "no"))
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
    const say = () => target.postMessage({ type: "ndx-iso", theme: scheme(), wheelZoom, ...(focus ? { focus } : {}) }, window.location.origin);
    say();
    const watch = new MutationObserver(() => target.postMessage({ type: "ndx-iso", theme: scheme() }, window.location.origin));
    watch.observe(document.documentElement, { attributes: true, attributeFilter: ["data-graview-scheme"] });
    return () => watch.disconnect();
  }, [loaded, focus, wheelZoom]);

  if (available === "no") return <Empty command="ndx analyze .">No code map yet: sourcevision has not analyzed this project, or the projection was emitted before it did.</Empty>;
  if (available === "checking") return <div className="ndx-iso" style={{ height }} aria-busy="true" />;
  return <iframe ref={frame} className="ndx-iso" src={ISO_MAP_URL} title={title} style={{ height }} onLoad={() => setLoaded(true)} />;
}
