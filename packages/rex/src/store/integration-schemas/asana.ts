/**
 * Asana integration schema definition.
 *
 * Encodes the configuration fields required by the Asana adapter
 * (`store/asana-adapter.ts`) for the web UI and CLI config surfaces.
 *
 * @module store/integration-schemas/asana
 */

import type { IntegrationSchema } from "../integration-schema.js";

export const asanaIntegrationSchema: IntegrationSchema = {
  id: "asana",
  name: "Asana",
  description: "Sync PRD items with tasks in an Asana project.",
  icon: "\u{1F535}",
  docsUrl: "https://developers.asana.com/docs",
  supportsConnectionTest: true,
  supportsSchemaValidation: false,
  builtIn: true,

  groups: {
    connection: {
      label: "Connection",
      icon: "\u{1F511}",
      order: 0,
      description: "Access token and target project for Asana.",
    },
  },

  setupGuide: [
    "Create a personal access token at [app.asana.com/0/my-apps](https://app.asana.com/0/my-apps) and copy it.",
    "Open the Asana project you want to sync PRD items with.",
    "Copy the project ID from the URL (the number after /0/ or /project/).",
    "Enter the token and project ID above.",
    "Test the connection to verify everything works.",
  ],

  fields: {
    token: {
      required: true,
      sensitive: true,
      description: "Asana personal access token",
      label: "Asana Access Token",
      inputType: "password",
      placeholder: "1/1234567890:abcdef...",
      helpText: "Personal access token from your Asana developer console.",
      docUrl: "https://app.asana.com/0/my-apps",
      docLabel: "app.asana.com/0/my-apps",
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
      description: "GID of the Asana project to sync with",
      label: "Project ID",
      inputType: "text",
      placeholder: "e.g. 1201234567890123",
      helpText: "The numeric project GID, visible in the project URL.",
      group: "connection",
      order: 1,
      validationRules: [
        {
          type: "pattern",
          pattern: "^[0-9]+$",
          message: "Project ID must be a numeric GID",
        },
      ],
    },
  },
};
