import { Hero, Page, type Ctx } from "../kit.js";
import { IsoFrame } from "../iso-frame.js";

/** THE CODE MAP: sourcevision's isometric map of the zones, the whole page given to it, so a plain scroll zooms. */
export function CodeMapScreen(_props: { context: Ctx }) {
  return (
    <Page testId="code-map">
      <Hero eyebrow="Code" title="Code map" lede="Each block is an area of the code: its footprint is its files, its height its lines, and the wires are the imports between areas. Pick one for its numbers and findings, or open it for the zones inside. A zone's own page shows where it sits here." />
      <IsoFrame title="Code map" height="calc(100vh - 13rem)" wheelZoom />
    </Page>
  );
}
