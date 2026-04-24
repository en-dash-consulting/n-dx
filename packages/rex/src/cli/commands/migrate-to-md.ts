import { join } from "node:path";
import { CLIError } from "../errors.js";
import { info } from "../output.js";
import {
  migrateJsonPrdToMarkdown,
  PRDMarkdownMigrationError,
} from "../../store/index.js";
import { REX_DIR } from "./constants.js";

export async function cmdMigrateToMd(
  dir: string,
): Promise<void> {
  const rexDir = join(dir, REX_DIR);

  try {
    const result = await migrateJsonPrdToMarkdown(rexDir);

    if (!result.migrated) {
      if (result.reason === "markdown-exists") {
        throw new CLIError(
          `Markdown PRD already exists at ${result.outputPath}.`,
          "Remove or rename .rex/prd.md if you want to regenerate it from .rex/prd.json.",
        );
      }

      throw new CLIError(
        `PRD JSON file not found at ${result.sourcePath}.`,
        "Run 'rex init' first, or point the command at a project with .rex/prd.json.",
      );
    }

    info(`Created markdown PRD at ${result.outputPath}`);
  } catch (error) {
    if (error instanceof CLIError) {
      throw error;
    }

    if (error instanceof PRDMarkdownMigrationError) {
      throw new CLIError(
        error.message,
        "Fix .rex/prd.json and retry, or inspect the generated markdown migration path for unsupported fields.",
      );
    }

    throw error;
  }
}
