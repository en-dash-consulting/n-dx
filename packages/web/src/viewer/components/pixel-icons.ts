/**
 * Pixel-art icons for the settings pages, in the family of the CLI mascots.
 *
 * Two variants per icon:
 *  - "tile"  22×22, navy square with the art on a teal ground line — page headers.
 *  - "glyph" 11×11, transparent, simplified — sidebar entries and the gear,
 *            drawn at 2 CSS px per pixel (a shrunk tile is unreadable).
 *
 * Tiles always sit on navy, so they use the palette as literals. Glyphs sit on
 * the sidebar background, which changes with the theme, so each colour comes
 * from a `--pixel-*` custom property defined in styles/tokens.css.
 *
 * Palette characters: `.` transparent, P purple, T teal, G steel, W white,
 * N navy, K screen.
 */

import { h } from "preact";

export type PixelIconName = "robot-wrangler" | "project" | "workflow" | "commands" | "settings";
export type PixelTileName = Exclude<PixelIconName, "settings">;

export const TILE_SIZE = 22;
export const GLYPH_SIZE = 11;

const PALETTE: Record<string, { literal: string; token: string }> = {
  P: { literal: "#6c41f0", token: "--pixel-purple" },
  T: { literal: "#00E5B9", token: "--pixel-teal" },
  G: { literal: "#c8c6d6", token: "--pixel-steel" },
  W: { literal: "#ffffff", token: "--pixel-white" },
  N: { literal: "#001769", token: "--pixel-navy" },
  K: { literal: "#000c3d", token: "--pixel-screen" },
};

const TILE_BACKGROUND = PALETTE.N.literal;
const GROUND_LINE_COLOR = PALETTE.T.literal;

export const PIXEL_TILES: Record<PixelTileName, readonly string[]> = {
  "robot-wrangler": [
    "......................",
    "......................",
    "........PPPPPP........",
    "...PP..PPPPPPPP..PP...",
    "...PP..PTTTTTTP..PP...",
    "...PPPPPPPPPPPPPPPP...",
    "......GGGGGGGGGG......",
    "......GTTTTTTTTG......",
    "......GTNNTTNNTG......",
    "......GTNNTTNNTG......",
    "......GTTTTTTTTG......",
    "......GGGGGGGGGG......",
    "..........GG..........",
    "......PPPPPPPPPP......",
    "....GGPPTTPPPPPPGG....",
    "....GGPPTTPPWWPPGG....",
    "....GG.PPPPPPPP.GG....",
    "........PP..PP........",
    "........GG..GG........",
    "......................",
    "......................",
    "......................",
  ],
  project: [
    "......................",
    "......................",
    "......................",
    "......................",
    "......................",
    "..PPPPPP..............",
    "..PPPPPPP.............",
    "..PPPPPPPPPPPPPPPPPP..",
    "..PPPPPPPPPPPPPPPPPP..",
    "..PNNNNNNNNNNNNNNNNP..",
    "..PPPPPPPPPPPPPPPPPP..",
    "..PPPPPPPPPPPPPPPPPP..",
    "..PPPPPPPPPWWWPPPPPP..",
    "..PPPTTTTTTWWWTTTPPP..",
    "..PPPPPPPPPWWWPPPPPP..",
    "..PPPPPPPPPPPPPPPPPP..",
    "..PPPPPPPPPPPPPPPPPP..",
    "..PPPPPPPPPPPPPPPPPP..",
    "..PPPPPPPPPPPPPPPPPP..",
    "......................",
    "......................",
    "......................",
  ],
  workflow: [
    "......................",
    "......................",
    "......................",
    "......................",
    "......................",
    "......................",
    "......................",
    "......................",
    "......................",
    "..PPPPP...............",
    "..PPWPP.....TTTT......",
    "..WWWWW.....TTTT......",
    "..PPWPP.....TTTT...W..",
    "..PPWPP.....TTTT...WW.",
    "GGGGGGGGGGGGGGGGGGGGGG",
    "G.P..P..P..P..P..P...G",
    "GGGGGGGGGGGGGGGGGGGGGG",
    "...G..............G...",
    "...G..............G...",
    "......................",
    "......................",
    "......................",
  ],
  commands: [
    "......................",
    "......................",
    "......................",
    "..GGGGGGGGGGGGGGGGGG..",
    "..GGGGGGGGGGGGGGGGGG..",
    "..GGKKKKKKKKKKKKKKGG..",
    "..GGKTKKKKKKKKKKKKGG..",
    "..GGKKTKKKKKKKKKKKGG..",
    "..GGKKKTKKKKKKKKKKGG..",
    "..GGKKTKKKKKKKKKKKGG..",
    "..GGKTKKKTTTTWKKKKGG..",
    "..GGKKKKKKKKKKKKKKGG..",
    "..GGKKKKKKKKKKKKKKGG..",
    "..GGGGGGGGGGGGGGTTGG..",
    "..GGGGGGGGGGGGGGGGGG..",
    ".........GGGG.........",
    ".........GGGG.........",
    "......PPPPPPPPPP......",
    ".....PPPPPPPPPPPP.....",
    "......................",
    "......................",
    "......................",
  ],
};

export const PIXEL_GLYPHS: Record<PixelIconName, readonly string[]> = {
  "robot-wrangler": [
    "...PPPPP...",
    "...PTTTP...",
    "PPPPPPPPPPP",
    ".GGGGGGGGG.",
    ".GTTTTTTTG.",
    ".GTNTTTNTG.",
    ".GTTTTTTTG.",
    ".GGGGGGGGG.",
    "...PPPPP...",
    "..GPPPPPG..",
    "...P...P...",
  ],
  project: [
    "...........",
    "PPPP.......",
    "PPPPPPPPPPP",
    "PNNNNNNNNNP",
    "PPPPPPWPPPP",
    "PTTTTTWTTTP",
    "PPPPPPWPPPP",
    "PPPPPPPPPPP",
    "PPPPPPPPPPP",
    "...........",
    "...........",
  ],
  workflow: [
    "...........",
    "...........",
    ".PPP.......",
    ".PWP..TTT..",
    ".PPP..TTT..",
    "GGGGGGGGGGG",
    "G.P.P.P.P.G",
    "GGGGGGGGGGG",
    ".G.......G.",
    ".G.......G.",
    "...........",
  ],
  commands: [
    "GGGGGGGGGGG",
    "GKKKKKKKKKG",
    "GKTKKKKKKKG",
    "GKKTKKKKKKG",
    "GKTKKTTWKKG",
    "GKKKKKKKKKG",
    "GGGGGGGGGGG",
    "....GGG....",
    "..PPPPPPP..",
    "...........",
    "...........",
  ],
  settings: [
    "....GGG....",
    ".GG.GGG.GG.",
    ".GGGGGGGGG.",
    "..GGGGGGG..",
    "GGGG...GGGG",
    "GGGG...GGGG",
    "GGGG...GGGG",
    "..GGGGGGG..",
    ".GGGGGGGGG.",
    ".GG.GGG.GG.",
    "....GGG....",
  ],
};

interface Rect { x: number; y: number; width: number; fill: string }

/** One rect per horizontal run of the same colour, so a map stays small. */
function runs(map: readonly string[], fillFor: (ch: string) => string): Rect[] {
  const rects: Rect[] = [];
  map.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const ch = row[x];
      let end = x + 1;
      while (end < row.length && row[end] === ch) end++;
      if (ch !== ".") rects.push({ x, y, width: end - x, fill: fillFor(ch) });
      x = end;
    }
  });
  return rects;
}

export type PixelIconProps =
  | { name: PixelTileName; variant: "tile"; size?: number; class?: string }
  | { name: PixelIconName; variant: "glyph"; size?: number; class?: string };

/** Default rendered size: tiles 1 CSS px per pixel ×2, glyphs 2 CSS px per pixel. */
const DEFAULT_SIZE = { tile: TILE_SIZE * 2, glyph: GLYPH_SIZE * 2 } as const;

export function PixelIcon({ name, variant, size, class: className }: PixelIconProps) {
  const isTile = variant === "tile";
  const grid = isTile ? TILE_SIZE : GLYPH_SIZE;
  const map = isTile ? PIXEL_TILES[name as PixelTileName] : PIXEL_GLYPHS[name];
  const px = size ?? DEFAULT_SIZE[variant];

  const rect = (r: { x: number; y: number; width: number; fill: string }) =>
    h("rect", { x: r.x, y: r.y, width: r.width, height: 1, fill: r.fill });

  const art = runs(map, (ch) => (isTile ? PALETTE[ch].literal : `var(${PALETTE[ch].token})`)).map(rect);

  const children = isTile
    ? [
        h("rect", { x: 0, y: 0, width: grid, height: grid, fill: TILE_BACKGROUND }),
        ...art,
        rect({ x: 2, y: 19, width: 20, fill: GROUND_LINE_COLOR }),
      ]
    : art;

  return h("svg", {
    class: className,
    viewBox: `0 0 ${grid} ${grid}`,
    width: px,
    height: px,
    "shape-rendering": "crispEdges",
    "aria-hidden": "true",
    focusable: "false",
  }, children);
}
