import { describe, expect, it } from "vitest";
import * as langKit from "../../src/index.js";

describe("@n-dx/lang-kit barrel", () => {
  it("exports the language facts sourcevision imports", () => {
    for (const name of [
      "typescriptConfig",
      "goConfig",
      "swiftConfig",
      "pythonConfig",
      "javaConfig",
      "javaSecondaryConfig",
      "terraformConfig",
      "isTerraformFile",
      "isGoStdlibPath",
      "detectLanguage",
      "detectLanguages",
      "getLanguageConfig",
      "languageConfigsFromIds",
      "mergeLanguageConfigs",
      "VALID_LANGUAGE_IDS",
      "readGoBuildModels",
      "discoverJavaModules",
      "readMavenBuildModels",
      "readGradleBuildModels",
      "parseToml",
      "parseXml",
      "parseYamlSubset",
      "isLanguagePackEntry",
      "extractSqlTableReferences",
      "extractSqlcTables",
      "looksLikeSql",
    ]) {
      expect(langKit, name).toHaveProperty(name);
    }
  });
});
