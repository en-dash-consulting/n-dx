/**
 * GitHub Projects integration schema definition.
 *
 * Encodes the configuration fields required by the GitHub Projects adapter
 * (`store/github-projects-adapter.ts`) for the web UI and CLI config surfaces.
 *
 * @module store/integration-schemas/github
 */

import type { IntegrationSchema } from "../integration-schema.js";

export const githubIntegrationSchema: IntegrationSchema = {
  id: "github",
  name: "GitHub Projects",
  description: "Sync PRD items with draft issues in a GitHub Projects (v2) board.",
  icon: "\u{1F419}",
  docsUrl: "https://docs.github.com/en/issues/planning-and-tracking-with-projects",
  supportsConnectionTest: true,
  supportsSchemaValidation: false,
  builtIn: true,

  groups: {
    connection: {
      label: "Connection",
      icon: "\u{1F511}",
      order: 0,
      description: "Access token and target project for GitHub Projects.",
    },
  },

  setupGuide: [
    "Create a fine-grained or classic personal access token with the `project` scope at [github.com/settings/tokens](https://github.com/settings/tokens).",
    "Open the GitHub Project (v2) you want to sync PRD items with.",
    "Copy the project's node ID (PVT_...) — from the project settings or the GraphQL API.",
    "Enter the token and project node ID above.",
    "Test the connection to verify everything works.",
  ],

  fields: {
    token: {
      required: true,
      sensitive: true,
      description: "GitHub personal access token with project scope",
      label: "GitHub Token",
      inputType: "password",
      placeholder: "ghp_xxxx or github_pat_xxxx",
      helpText: "Personal access token with the `project` scope.",
      docUrl: "https://github.com/settings/tokens",
      docLabel: "github.com/settings/tokens",
      group: "connection",
      order: 0,
      validationRules: [
        {
          type: "minLength",
          minLength: 10,
          message: "Access token appears too short",
        },
      ],
    },
    projectId: {
      required: true,
      sensitive: false,
      description: "Node ID of the target GitHub Project (v2)",
      label: "Project Node ID",
      inputType: "text",
      placeholder: "e.g. PVT_kwDOABCD1234",
      helpText: "The ProjectV2 node ID, which starts with 'PVT_'.",
      group: "connection",
      order: 1,
      validationRules: [
        {
          type: "pattern",
          pattern: "^PVT_",
          message: "Project node ID must start with 'PVT_'",
        },
      ],
    },
  },
};
