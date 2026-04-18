import type { AppConfig } from "./types.js";

export const DEFAULT_PORT = 3000;
export const DEFAULT_HOST = "localhost";

export function loadConfig(): AppConfig {
  return {
    port: Number(process.env.PORT) || DEFAULT_PORT,
    host: process.env.HOST || DEFAULT_HOST,
    logLevel: (process.env.LOG_LEVEL as AppConfig["logLevel"]) || "info",
  };
}
