import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: [
      // Map local .js imports to .ts files
      { find: /^(\..+)\.js$/, replacement: "$1.ts" },
    ],
  },
  test: {
    // Shared: pin color detection so an ambient FORCE_COLOR in the developer's
    // shell cannot change test verdicts. See tests/setup-color-env.js.
    setupFiles: [
      "../../tests/setup-color-env.js",
      "../../tests/setup-session-env.js",
      // Clears TYPESAFE_API_KEY. askJev reads it from process.env by default,
      // so without this an ambient key turns any test that forgets to pass
      // `env` into a live, billed request. Moved here with the Jev client.
      "../../tests/setup-judgment-env.js",
    ],
    include: ["tests/**/*.test.ts"],
  },
});
