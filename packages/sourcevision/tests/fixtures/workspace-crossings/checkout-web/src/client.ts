import type { OrderSummary } from "@acme/orders-api";

/** Reaches the orders service at a literal host — matched on host + route. */
export async function loadOrders(): Promise<OrderSummary[]> {
  const res = await fetch("https://orders.internal:8443/api/orders");
  return (await res.json()) as OrderSummary[];
}

/** Reaches it through an environment variable — matched on the name alone. */
export async function loadOrder(): Promise<OrderSummary> {
  const res = await fetch(process.env.ORDERS_URL);
  return (await res.json()) as OrderSummary;
}
