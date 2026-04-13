/**
 * Shared utilities for the web package.
 *
 * Framework-agnostic modules used by both the viewer and server layers.
 * Each module has zero external dependencies — integration with Preact
 * or other frameworks is handled by the consumer.
 */

export { DATA_FILES, ALL_DATA_FILES, SUPPLEMENTARY_FILES } from "./data-files.js";
export type { ViewId } from "./view-id.js";
export type { FeatureToggle, FeaturesResponse } from "./features.js";
