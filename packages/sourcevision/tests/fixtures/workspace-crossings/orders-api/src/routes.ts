import type { Express, Request, Response } from "express";
import type { OrderSummary } from "./index.js";

const ORDERS: OrderSummary[] = [];

function listOrders(_req: Request, res: Response): void {
  res.json(ORDERS);
}

function getOrder(req: Request, res: Response): void {
  res.json(ORDERS.find((o) => o.id === req.params.id));
}

export function registerRoutes(app: Express): void {
  app.get("/api/orders", listOrders);
  app.get("/api/orders/:id", getOrder);
}
