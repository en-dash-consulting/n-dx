/**
 * Public API surface regression test.
 *
 * Verifies that all exports are available at their documented paths after the
 * circular dependency refactoring (Feb 2026). The refactoring relocated:
 *
 *   - `LLMVendor` — moved from `llm-types.ts` to `provider-interface.ts`,
 *     re-exported through `llm-types.ts` so the import path is unchanged.
 *
 *   - `CreateLLMClientOptions` — moved from `llm-types.ts` to `llm-client.ts`,
 *     now exported directly from `llm-client.ts` via `public.ts`.
 *
 * If any of these assertions fail, an export was accidentally dropped or
 * renamed. This test should be the first thing fixed before any release.
 */

import { describe, it, expect } from "vitest";

// ── Import everything through the public entry point ──────────────────────
// Type imports (erased at runtime; their presence validates the TypeScript
// contract that the public API exposes these shapes).
import type {
  // provider-interface.ts (via public.ts)
  ProviderAuthMode,
  ProviderCapability,
  ProviderInfo,
  StreamChunk,
  LLMProvider,
  // llm-types.ts (LLMVendor re-exported from provider-interface.ts)
  LLMVendor,
  CodexConfig,
  LLMConfig,
  LLMClient,
  // types.ts
  TokenUsage,
  ClaudeConfig,
  AuthMode,
  ClaudeClientOptions,
  CompletionRequest,
  CompletionResult,
  ErrorReason,
  ClaudeClient,
  // llm-client.ts (moved from llm-types.ts in Feb 2026 refactor)
  CreateLLMClientOptions,
  // api-provider.ts
  ApiProviderOptions,
  // cli-provider.ts
  CliProviderOptions,
  // codex-cli-provider.ts
  CodexCliProviderOptions,
  // openai-api-provider.ts
  OpenAiApiProviderOptions,
  // create-client.ts
  CreateClientOptions,
  // auth.ts
  AuthDetectionResult,
  AuthDiagnostics,
  // exec.ts
  ExecResult,
  ExecOptions,
  SpawnToolOptions,
  SpawnToolResult,
  ManagedChild,
  // project-dirs.ts
  ProjectDir,
  // help-format.ts
  HelpOption,
  HelpExample,
  HelpDefinition,
  UsageSection,
  UsageDefinition,
  // provider-registry.ts
  ProviderFactory,
  // vendor-header.ts
  VendorModelHeaderOptions,
} from "../../src/public.js";

// Value imports (present at runtime; used directly in assertions below).
import {
  // types.ts — error classes
  ClaudeClientError,
  CLIError,
  // provider-registry.ts
  ProviderRegistry,
  createDefaultRegistry,
  defaultRegistry,
  // provider-session.ts
  ProviderSession,
  createProviderSession,
  // llm-config.ts
  loadLLMConfig,
  // llm-client.ts
  createLLMClient,
  detectLLMAuthMode,
  // config.ts
  loadClaudeConfig,
  resolveApiKey,
  resolveCliPath,
  resolveModel,
  resolveVendorModel,
  NEWEST_MODELS,
  // token-usage.ts
  parseApiTokenUsage,
  parseCliTokenUsage,
  parseStreamTokenUsage,
  // api-provider.ts
  createApiClient,
  // cli-provider.ts
  createCliClient,
  // codex-cli-provider.ts
  createCodexCliClient,
  compileCodexPolicyFlags,
  mapSandboxToCodexFlag,
  mapApprovalToCodexFlag,
  // openai-api-provider.ts
  createOpenAiApiProvider,
  resolveOpenAiApiKey,
  parseOpenAiTokenUsage,
  // create-client.ts
  createClient,
  detectAuthMode,
  // auth.ts
  detectCliAvailability,
  validateApiKey,
  detectAvailableAuth,
  diagnoseAuth,
  // exec.ts
  exec,
  execStdout,
  execShellCmd,
  getCurrentHead,
  getCurrentBranch,
  isExecutableOnPath,
  spawnTool,
  spawnManaged,
  ProcessPool,
  ProcessLimitError,
  // project-dirs.ts
  PROJECT_DIRS,
  // json.ts
  toCanonicalJSON,
  // project-config.ts
  deepMerge,
  loadProjectOverrides,
  mergeWithOverrides,
  // output.ts
  setQuiet,
  isQuiet,
  info,
  result,
  // vendor-header.ts
  printVendorModelHeader,
  // suggest.ts
  editDistance,
  suggestCommands,
  formatTypoSuggestion,
  // help-format.ts
  isColorEnabled,
  resetColorCache,
  bold,
  dim,
  cyan,
  yellow,
  green,
  red,
  colorSuccess,
  colorError,
  colorPending,
  colorWarn,
  colorInfo,
  colorDim,
  STATUS_COLORS,
  colorStatus,
  cmd,
  flag,
  sectionHeader,
  requiredParam,
  optionalParam,
  formatHelp,
  formatUsage,
} from "../../src/public.js";

// ── Function exports ───────────────────────────────────────────────────────

describe("public API — function exports", () => {
  it("exports createLLMClient as a function", () => {
    expect(typeof createLLMClient).toBe("function");
  });

  it("exports detectLLMAuthMode as a function", () => {
    expect(typeof detectLLMAuthMode).toBe("function");
  });

  it("exports loadLLMConfig as a function", () => {
    expect(typeof loadLLMConfig).toBe("function");
  });

  it("exports createClient as a function", () => {
    expect(typeof createClient).toBe("function");
  });

  it("exports detectAuthMode as a function", () => {
    expect(typeof detectAuthMode).toBe("function");
  });

  it("exports createApiClient as a function", () => {
    expect(typeof createApiClient).toBe("function");
  });

  it("exports createCliClient as a function", () => {
    expect(typeof createCliClient).toBe("function");
  });

  it("exports createCodexCliClient as a function", () => {
    expect(typeof createCodexCliClient).toBe("function");
  });

  it("exports compileCodexPolicyFlags as a function", () => {
    expect(typeof compileCodexPolicyFlags).toBe("function");
  });

  it("exports mapSandboxToCodexFlag as a function", () => {
    expect(typeof mapSandboxToCodexFlag).toBe("function");
  });

  it("exports mapApprovalToCodexFlag as a function", () => {
    expect(typeof mapApprovalToCodexFlag).toBe("function");
  });

  it("exports createOpenAiApiProvider as a function", () => {
    expect(typeof createOpenAiApiProvider).toBe("function");
  });

  it("exports resolveOpenAiApiKey as a function", () => {
    expect(typeof resolveOpenAiApiKey).toBe("function");
  });

  it("exports parseOpenAiTokenUsage as a function", () => {
    expect(typeof parseOpenAiTokenUsage).toBe("function");
  });

  it("exports loadClaudeConfig as a function", () => {
    expect(typeof loadClaudeConfig).toBe("function");
  });

  it("exports resolveApiKey as a function", () => {
    expect(typeof resolveApiKey).toBe("function");
  });

  it("exports resolveCliPath as a function", () => {
    expect(typeof resolveCliPath).toBe("function");
  });

  it("exports resolveModel as a function", () => {
    expect(typeof resolveModel).toBe("function");
  });

  it("exports resolveVendorModel as a function", () => {
    expect(typeof resolveVendorModel).toBe("function");
  });

  it("exports NEWEST_MODELS as an object with claude and codex keys", () => {
    expect(typeof NEWEST_MODELS).toBe("object");
    expect(NEWEST_MODELS).not.toBeNull();
    expect(typeof NEWEST_MODELS.claude).toBe("string");
    expect(typeof NEWEST_MODELS.codex).toBe("string");
  });

  it("exports parseApiTokenUsage as a function", () => {
    expect(typeof parseApiTokenUsage).toBe("function");
  });

  it("exports parseCliTokenUsage as a function", () => {
    expect(typeof parseCliTokenUsage).toBe("function");
  });

  it("exports parseStreamTokenUsage as a function", () => {
    expect(typeof parseStreamTokenUsage).toBe("function");
  });

  it("exports detectCliAvailability as a function", () => {
    expect(typeof detectCliAvailability).toBe("function");
  });

  it("exports validateApiKey as a function", () => {
    expect(typeof validateApiKey).toBe("function");
  });

  it("exports detectAvailableAuth as a function", () => {
    expect(typeof detectAvailableAuth).toBe("function");
  });

  it("exports diagnoseAuth as a function", () => {
    expect(typeof diagnoseAuth).toBe("function");
  });
});

// ── Process execution exports ──────────────────────────────────────────────

describe("public API — process execution exports", () => {
  it("exports exec as a function", () => {
    expect(typeof exec).toBe("function");
  });

  it("exports execStdout as a function", () => {
    expect(typeof execStdout).toBe("function");
  });

  it("exports execShellCmd as a function", () => {
    expect(typeof execShellCmd).toBe("function");
  });

  it("exports getCurrentHead as a function", () => {
    expect(typeof getCurrentHead).toBe("function");
  });

  it("exports getCurrentBranch as a function", () => {
    expect(typeof getCurrentBranch).toBe("function");
  });

  it("exports isExecutableOnPath as a function", () => {
    expect(typeof isExecutableOnPath).toBe("function");
  });

  it("exports spawnTool as a function", () => {
    expect(typeof spawnTool).toBe("function");
  });

  it("exports spawnManaged as a function", () => {
    expect(typeof spawnManaged).toBe("function");
  });

  it("exports ProcessPool as a class", () => {
    expect(typeof ProcessPool).toBe("function");
  });

  it("exports ProcessLimitError as a class", () => {
    expect(typeof ProcessLimitError).toBe("function");
  });
});

// ── Error class exports ────────────────────────────────────────────────────

describe("public API — error class exports", () => {
  it("exports ClaudeClientError as a constructor", () => {
    expect(typeof ClaudeClientError).toBe("function");
    const err = new ClaudeClientError("test", "unknown", false);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ClaudeClientError);
    expect(err.reason).toBe("unknown");
    expect(err.retryable).toBe(false);
  });

  it("exports CLIError as a constructor extending ClaudeClientError", () => {
    expect(typeof CLIError).toBe("function");
    const err = new CLIError("cli test");
    expect(err).toBeInstanceOf(ClaudeClientError);
    expect(err).toBeInstanceOf(CLIError);
    expect(err.reason).toBe("cli");
  });
});

// ── Provider registry exports ──────────────────────────────────────────────

describe("public API — provider registry exports", () => {
  it("exports ProviderRegistry as a class", () => {
    expect(typeof ProviderRegistry).toBe("function");
  });

  it("exports createDefaultRegistry as a function", () => {
    expect(typeof createDefaultRegistry).toBe("function");
  });

  it("exports defaultRegistry as a ProviderRegistry instance", () => {
    expect(defaultRegistry).toBeInstanceOf(ProviderRegistry);
  });

  it("exports ProviderSession as a class", () => {
    expect(typeof ProviderSession).toBe("function");
  });

  it("exports createProviderSession as a function", () => {
    expect(typeof createProviderSession).toBe("function");
  });
});

// ── Utility exports ────────────────────────────────────────────────────────

describe("public API — utility exports", () => {
  it("exports PROJECT_DIRS as an object", () => {
    expect(typeof PROJECT_DIRS).toBe("object");
    expect(PROJECT_DIRS).not.toBeNull();
  });

  it("exports toCanonicalJSON as a function", () => {
    expect(typeof toCanonicalJSON).toBe("function");
  });

  it("exports deepMerge as a function", () => {
    expect(typeof deepMerge).toBe("function");
  });

  it("exports loadProjectOverrides as a function", () => {
    expect(typeof loadProjectOverrides).toBe("function");
  });

  it("exports mergeWithOverrides as a function", () => {
    expect(typeof mergeWithOverrides).toBe("function");
  });

  it("exports setQuiet as a function", () => {
    expect(typeof setQuiet).toBe("function");
  });

  it("exports isQuiet as a function", () => {
    expect(typeof isQuiet).toBe("function");
  });

  it("exports info as a function", () => {
    expect(typeof info).toBe("function");
  });

  it("exports result as a function", () => {
    expect(typeof result).toBe("function");
  });

  it("exports printVendorModelHeader as a function", () => {
    expect(typeof printVendorModelHeader).toBe("function");
  });

  it("exports editDistance as a function", () => {
    expect(typeof editDistance).toBe("function");
  });

  it("exports suggestCommands as a function", () => {
    expect(typeof suggestCommands).toBe("function");
  });

  it("exports formatTypoSuggestion as a function", () => {
    expect(typeof formatTypoSuggestion).toBe("function");
  });
});

// ── Help formatting exports ────────────────────────────────────────────────

describe("public API — help formatting exports", () => {
  it("exports isColorEnabled as a function", () => {
    expect(typeof isColorEnabled).toBe("function");
  });

  it("exports resetColorCache as a function", () => {
    expect(typeof resetColorCache).toBe("function");
  });

  it("exports bold as a function", () => {
    expect(typeof bold).toBe("function");
  });

  it("exports dim as a function", () => {
    expect(typeof dim).toBe("function");
  });

  it("exports cyan as a function", () => {
    expect(typeof cyan).toBe("function");
  });

  it("exports yellow as a function", () => {
    expect(typeof yellow).toBe("function");
  });

  it("exports green as a function", () => {
    expect(typeof green).toBe("function");
  });

  it("exports red as a function", () => {
    expect(typeof red).toBe("function");
  });

  it("exports colorSuccess as a function", () => {
    expect(typeof colorSuccess).toBe("function");
  });

  it("exports colorError as a function", () => {
    expect(typeof colorError).toBe("function");
  });

  it("exports colorPending as a function", () => {
    expect(typeof colorPending).toBe("function");
  });

  it("exports colorWarn as a function", () => {
    expect(typeof colorWarn).toBe("function");
  });

  it("exports colorInfo as a function", () => {
    expect(typeof colorInfo).toBe("function");
  });

  it("exports colorDim as a function", () => {
    expect(typeof colorDim).toBe("function");
  });

  it("exports STATUS_COLORS as an object", () => {
    expect(typeof STATUS_COLORS).toBe("object");
    expect(STATUS_COLORS).not.toBeNull();
  });

  it("exports colorStatus as a function", () => {
    expect(typeof colorStatus).toBe("function");
  });

  it("exports cmd as a function", () => {
    expect(typeof cmd).toBe("function");
  });

  it("exports flag as a function", () => {
    expect(typeof flag).toBe("function");
  });

  it("exports sectionHeader as a function", () => {
    expect(typeof sectionHeader).toBe("function");
  });

  it("exports requiredParam as a function", () => {
    expect(typeof requiredParam).toBe("function");
  });

  it("exports optionalParam as a function", () => {
    expect(typeof optionalParam).toBe("function");
  });

  it("exports formatHelp as a function", () => {
    expect(typeof formatHelp).toBe("function");
  });

  it("exports formatUsage as a function", () => {
    expect(typeof formatUsage).toBe("function");
  });
});

// ── Refactoring-specific regression guards ─────────────────────────────────
// These verify the types that were relocated during the Feb 2026 circular
// dependency refactoring are still accessible through their original import
// paths (consumers are unaffected by the internal move).

describe("public API — refactoring regression guards", () => {
  it("LLMVendor is importable as a type (moved from llm-types to provider-interface)", () => {
    // Verify LLMVendor values work at runtime via ProviderInfo
    const info: ProviderInfo = {
      vendor: "claude" satisfies LLMVendor,
      mode: "api",
      capabilities: [],
    };
    expect(info.vendor).toBe("claude");

    const codexInfo: ProviderInfo = {
      vendor: "codex" satisfies LLMVendor,
      mode: "cli",
      capabilities: [],
    };
    expect(codexInfo.vendor).toBe("codex");
  });

  it("CreateLLMClientOptions is usable (moved from llm-types to llm-client)", () => {
    // Verify CreateLLMClientOptions works as a type and its fields are respected
    const options: CreateLLMClientOptions = {
      vendor: "claude",
      llmConfig: { vendor: "claude", claude: { api_key: "sk-ant-test" } },
    };
    // The factory should use these options
    const client = createLLMClient(options);
    expect(client.mode).toBe("api");
  });

  it("LLMClient type alias is accessible", () => {
    // LLMClient is an alias for ClaudeClient — validate at runtime via duck typing
    const client = createLLMClient({
      llmConfig: { vendor: "claude", claude: { api_key: "sk-ant-test" } },
    }) satisfies LLMClient;
    expect(typeof client.complete).toBe("function");
  });

  it("LLMConfig type is accessible and its vendor field accepts LLMVendor", () => {
    const config: LLMConfig = {
      vendor: "codex",
      codex: { cli_path: "/usr/local/bin/codex" },
    };
    expect(config.vendor).toBe("codex");
  });

  it("CodexConfig type is accessible", () => {
    const codex: CodexConfig = {
      cli_path: "/usr/local/bin/codex",
      model: "gpt-5-codex",
    };
    expect(codex.cli_path).toBe("/usr/local/bin/codex");
  });
});
