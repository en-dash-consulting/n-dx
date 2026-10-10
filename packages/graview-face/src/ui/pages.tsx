/**
 * n-dx's OWN FACE. The shell and the home are replaced; capabilities,
 * changes, zones and runs get pages in n-dx's words; the pages about no one
 * kind (needs attention, the inbox, spend) are routes of their own. Every
 * other kind gets the generic list and record, so a kind added to the
 * declaration tomorrow is dressed too, and every derived page stays
 * reachable — the problems page, the places, search.
 */
import type { AnySchema } from "@graview/core";
import { createPageRegistry, type PageComponent } from "@graview/pages";
import type { ReactNode } from "react";
import type { App } from "../app.js";
import type { Ctx } from "./kit.js";
import { shell } from "./shell.js";
import { HomeScreen } from "./screens/home.js";
import { CapabilityScreen } from "./screens/capability.js";
import { ChangeScreen, ChangesScreen } from "./screens/change.js";
import { ZoneScreen } from "./screens/zone.js";
import { RunScreen } from "./screens/run.js";
import { AttentionScreen, InboxScreen, SpendScreen } from "./screens/attention.js";
import { KindList, KindRecord } from "./screens/generic.js";

type P = PageComponent<AnySchema>;

export function pages(app: App) {
  const schema = app.schema;
  const kinds = schema.kinds as readonly string[];
  const page = (component: (props: { context: Ctx }) => ReactNode) => component as P;
  const own = { list: new Set(["change"]), record: new Set(["capability", "change", "zone", "run"]) };

  let registry = createPageRegistry<AnySchema, P>(schema);
  for (const kind of kinds) {
    if (!own.list.has(kind)) registry = registry.register(kind, "list", page(({ context }) => <KindList context={context} app={app} kind={kind} />));
    if (!own.record.has(kind)) registry = registry.register(kind, "record", page(({ context }) => <KindRecord context={context} app={app} kind={kind} />));
  }
  registry = registry
    .surface("shell", shell(app), { without: ["undo"] })
    .surface("home", page(({ context }) => <HomeScreen context={context} app={app} />))
    .route("/attention", page(({ context }) => <AttentionScreen context={context} />))
    .route("/inbox", page(({ context }) => <InboxScreen context={context} />))
    .route("/spend", page(({ context }) => <SpendScreen context={context} />));
  if (kinds.includes("capability")) registry = registry.register("capability", "record", page(({ context }) => <CapabilityScreen context={context} app={app} />));
  if (kinds.includes("change")) {
    registry = registry
      .register("change", "record", page(({ context }) => <ChangeScreen context={context} app={app} />))
      .register("change", "list", page(({ context }) => <ChangesScreen context={context} />));
  }
  if (kinds.includes("zone")) registry = registry.register("zone", "record", page(({ context }) => <ZoneScreen context={context} app={app} />));
  if (kinds.includes("run")) registry = registry.register("run", "record", page(({ context }) => <RunScreen context={context} app={app} />));
  return registry;
}
