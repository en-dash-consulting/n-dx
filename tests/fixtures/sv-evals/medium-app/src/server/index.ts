import { createServer } from "./app.js";
import { registerUserRoutes } from "./routes/users.js";
import { registerPostRoutes } from "./routes/posts.js";
import { registerAuthRoutes } from "./routes/auth.js";

export async function main(): Promise<void> {
  const server = createServer();
  registerUserRoutes(server);
  registerPostRoutes(server);
  registerAuthRoutes(server);
  await server.listen(3000);
}
