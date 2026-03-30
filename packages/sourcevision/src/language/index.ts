/**
 * Language registry barrel — re-exports all language-related types and configs.
 *
 * @module sourcevision/language
 */

// Interface
export type { LanguageConfig } from "./registry.js";

// Language configs
export { typescriptConfig } from "./typescript.js";
export { goConfig } from "./go.js";

// Detection
export { detectLanguage, detectLanguages, mergeLanguageConfigs, getLanguageConfig, VALID_LANGUAGE_IDS } from "./detect.js";
