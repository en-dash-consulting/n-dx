import type { AppConfig, ApiResponse, User } from "../types.js";
import { formatName } from "../utils/format.js";

export function createApp(config: AppConfig) {
  return {
    async start(): Promise<void> {
      console.log(`Listening on ${config.host}:${config.port}`);
    },
  };
}

export async function fetchUser(id: string): Promise<ApiResponse<User>> {
  const res = await fetch(`/api/users/${id}`);
  if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
  const user = (await res.json()) as User;
  return { ok: true, data: { ...user, name: formatName(user.name, "") } };
}
