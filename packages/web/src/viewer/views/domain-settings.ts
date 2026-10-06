/**
 * Settings domain views — barrel module.
 *
 * Groups all cross-cutting configuration view components behind a single
 * import boundary. This establishes a natural decomposition point within the
 * web-viewer zone.
 *
 * Domain scope: the settings pages (Robot Wrangler, Project, Workflow) and the
 * Commands page. Project's sections — project settings and feature flags — are
 * components of `project.ts`, not views of their own.
 */

export { WorkflowView } from "./workflow.js";
export { CommandsView } from "./commands.js";
export { CommandReferenceView } from "./command-reference.js";
export { RobotWranglerView } from "./robot-wrangler.js";
export { ProjectView } from "./project.js";
