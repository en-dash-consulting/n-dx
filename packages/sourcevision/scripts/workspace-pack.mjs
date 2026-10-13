/**
 * Import a language pack from the n-dx workspace for a corpus or comparison
 * script: `@n-dx/lang-java` resolves to the workspace package's built `dist`.
 * Exits 2, naming the build command, when it is not built.
 */

export async function importWorkspacePack(name) {
  try {
    return await import(name);
  } catch (error) {
    console.error(`${name} could not be imported (${error.message}) — run \`pnpm --filter ${name} build\``);
    process.exit(2);
  }
}
