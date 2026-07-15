/**
 * Jira integration schema definition.
 *
 * Backs the built-in Jira adapter (`store/jira-adapter.ts`) — defines the
 * configuration fields (domain, email, API token, project) surfaced by the web
 * UI and CLI config flows.
 *
 * @module store/integration-schemas/jira
 */

import type { IntegrationSchema } from "../integration-schema.js";

export const jiraIntegrationSchema: IntegrationSchema = {
  id: "jira",
  name: "Jira",
  description: "Sync PRD items with Jira issues for project tracking.",
  icon: "\u{1F3AF}",
  docsUrl: "https://developer.atlassian.com/cloud/jira/platform/rest/v3/",
  supportsConnectionTest: true,
  supportsSchemaValidation: false,
  builtIn: true,

  groups: {
    connection: {
      label: "Connection",
      icon: "\u{1F310}",
      order: 0,
      description: "Jira instance URL and authentication.",
    },
    project: {
      label: "Project Mapping",
      icon: "\u{1F4CB}",
      order: 1,
      description: "Configure how PRD items map to Jira issues.",
    },
  },

  setupGuide: [
    "Log in to your Jira Cloud instance and go to Settings → API Tokens.",
    "Generate a new API token and copy it.",
    "Enter your Jira domain (e.g. your-company.atlassian.net).",
    "Select the project to sync PRD items with.",
    "Test the connection to verify everything works.",
  ],

  fields: {
    domain: {
      required: true,
      sensitive: false,
      description: "Jira Cloud domain (e.g. your-company.atlassian.net)",
      label: "Jira Domain",
      inputType: "url",
      placeholder: "your-company.atlassian.net",
      helpText: "Your Jira Cloud instance domain, without https://.",
      docUrl: "https://support.atlassian.com/jira-cloud-administration/docs/manage-jira-cloud-domains/",
      docLabel: "Jira domain docs",
      group: "connection",
      order: 0,
      validationRules: [
        {
          type: "pattern",
          pattern: "^[a-zA-Z0-9-]+\\.atlassian\\.net$",
          message: "Domain must be in the format 'your-company.atlassian.net'",
        },
      ],
    },
    email: {
      required: true,
      sensitive: false,
      description: "Email address associated with your Jira account",
      label: "Email",
      inputType: "email",
      placeholder: "you@company.com",
      helpText: "The email address you use to log in to Jira.",
      group: "connection",
      order: 1,
      validationRules: [
        {
          type: "pattern",
          pattern: "^[^@]+@[^@]+\\.[^@]+$",
          message: "Enter a valid email address",
        },
      ],
    },
    apiToken: {
      required: true,
      sensitive: true,
      description: "Jira API token for authentication",
      label: "API Token",
      inputType: "password",
      placeholder: "Your Jira API token",
      helpText: "Generate an API token from your Atlassian account settings.",
      docUrl: "https://id.atlassian.com/manage-profile/security/api-tokens",
      docLabel: "Manage API tokens",
      group: "connection",
      order: 2,
      validationRules: [
        {
          type: "minLength",
          minLength: 10,
          message: "API token appears too short",
        },
      ],
    },
    projectKey: {
      required: true,
      sensitive: false,
      description: "Jira project key to sync with",
      label: "Project Key",
      inputType: "text",
      placeholder: "e.g. PRD",
      helpText: "The short key for your Jira project (visible in issue IDs like PRD-123).",
      group: "project",
      order: 0,
      validationRules: [
        {
          type: "pattern",
          pattern: "^[A-Z][A-Z0-9_]{1,9}$",
          message: "Project key must be 2-10 uppercase letters/numbers starting with a letter",
        },
      ],
    },
    issueType: {
      required: false,
      sensitive: false,
      description: "Default Jira issue type for new PRD items",
      label: "Default Issue Type",
      inputType: "select",
      helpText: "The issue type used when creating new Jira issues from PRD items.",
      group: "project",
      order: 1,
      defaultValue: "Task",
      options: [
        { label: "Task", value: "Task", description: "Standard work item" },
        { label: "Story", value: "Story", description: "User story" },
        { label: "Epic", value: "Epic", description: "Large body of work" },
        { label: "Bug", value: "Bug", description: "Defect or issue" },
      ],
    },
    syncLabels: {
      required: false,
      sensitive: false,
      description: "Sync PRD tags as Jira labels",
      label: "Sync Labels",
      inputType: "checkbox",
      helpText: "When enabled, PRD item tags are synced as Jira issue labels.",
      group: "project",
      order: 2,
      defaultValue: true,
    },
  },
};
