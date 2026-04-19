/**
 * Settings/integration domain views — barrel module.
 *
 * Groups all cross-cutting configuration and integration view components
 * behind a single import boundary. This establishes a natural decomposition
 * point within the web-viewer zone.
 *
 * Domain scope: Notion config, external integrations, and feature toggles.
 */

export { NotionConfigView } from "./notion-config.js";
export { IntegrationConfigView } from "./integration-config.js";
export { FeatureTogglesView } from "./feature-toggles.js";
export { CliTimeoutsView } from "./cli-timeout.js";
export { CommandsView } from "./commands.js";
export { LlmProviderView } from "./llm-provider.js";
export { ProjectSettingsView } from "./project-settings.js";
