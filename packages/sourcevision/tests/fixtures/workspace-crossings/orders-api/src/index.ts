export interface OrderSummary {
  id: string;
  total: number;
}

export { registerRoutes } from "./routes.js";
export { publishOrderEvent } from "./queue.js";
