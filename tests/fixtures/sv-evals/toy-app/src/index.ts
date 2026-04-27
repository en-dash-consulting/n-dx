import { createApp } from "./services/api.js";
import { loadConfig } from "./config.js";

export async function main(): Promise<void> {
  const config = loadConfig();
  const app = createApp(config);
  await app.start();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
