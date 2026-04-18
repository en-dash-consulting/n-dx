import { loggerMiddleware } from "./middleware/logger.js";
import { authMiddleware } from "./middleware/auth.js";

export interface Server {
  use: (fn: unknown) => void;
  listen: (port: number) => Promise<void>;
}

export function createServer(): Server {
  const middleware: unknown[] = [];
  middleware.push(loggerMiddleware);
  middleware.push(authMiddleware);
  return {
    use: (fn) => middleware.push(fn),
    listen: async (port) => {
      console.log(`Server listening on ${port}, ${middleware.length} middleware loaded`);
    },
  };
}
