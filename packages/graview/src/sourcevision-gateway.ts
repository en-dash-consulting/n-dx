/**
 * Centralized gateway for `@n-dx/sourcevision` imports.
 *
 * Sourcevision exposes no loader: its output is JSON on disk, read here
 * against the schema types it publishes. `DATA_FILES` names the files so the
 * projection cannot drift from what `sv analyze` writes. The isometric map's
 * loader and renderer come through here too: `emit` writes the map the face
 * embeds.
 *
 * @module graview/sourcevision-gateway
 * @see ./rex-gateway.ts — the rex PRD model
 * @see ./hench-gateway.ts — hench's run record type
 * @see ./llm-gateway.ts — layout and spawning
 */
export { DATA_FILES } from "@n-dx/sourcevision";
// The isometric architecture map, written beside the snapshot for the face's Code map.
export { loadFromSourcevision, buildIsoModel, renderIsoMap } from "@n-dx/sourcevision";
export type { Zones, Zone, ZoneCrossing, Components, ComponentDefinition, Inventory, FileEntry } from "@n-dx/sourcevision";
