import { defineConfig } from "vitest/config";
import { ndxDoor } from "./dev/ndx-door.js";

export default defineConfig({
  esbuild: { jsx: "automatic" },
  // The door to n-dx in development only: a proxy to rex behind the hub, a re-emit, and the fresh projection.
  plugins: [ndxDoor()],
  build: {
    outDir: "build",
    target: "es2022",
    rollupOptions: {
      output: {
        // The framework split from the app along its own tier boundary, as the scaffold does:
        // headless core/layout/tools/ship, the React UI binding, and React itself, each cached on its own schedule.
        manualChunks(id: string) {
          const parts = id.split("/");
          const owner = Math.max(parts.lastIndexOf("@graview"), parts.lastIndexOf("packages"));
          const name = owner === -1 ? undefined : parts[owner + 1];
          if (name && ["core", "layout", "tools", "ship"].includes(name)) return "graview";
          if (name && ["react", "primitives", "pages", "render", "embed", "studio"].includes(name)) return "graview-ui";
          const vendor = parts.lastIndexOf("node_modules");
          const from = vendor === -1 ? undefined : parts[vendor + 1];
          if (from === "zod") return "graview";
          if (from && ["react", "react-dom", "react-router", "react-router-dom", "scheduler"].includes(from)) return "vendor";
          return undefined;
        },
      },
    },
  },
  server: { port: 5188, strictPort: true },
  test: { environment: "node", include: ["tests/**/*.test.ts"] },
});
