/**
 * What the hub's request handlers (routes.ts, proxy.ts) need of the hub.
 *
 * The `Hub` class hands itself to them, and they used to name it by its class,
 * which imported hub.ts from the modules hub.ts imports: an import cycle. They
 * name this instead, and `Hub` declares that it implements it, so the compiler
 * keeps the two in step: a member a handler starts using is added here, and
 * `Hub` must then provide it.
 *
 * @module hub/hub-host
 */

import type { CredentialStore } from "../shared/index.js";
import type { AdmissionGate, PublicQueueSnapshot } from "./admission.js";
import type { ListExtensions } from "./extensions.js";
import type { FrameKeys } from "./frame-keys.js";
import type { ProjectView, RegisterProjectInput, WorktreeRemoval } from "./project-view.js";
import type { HubSessionHostPicker } from "./session-host.js";
import type { SidecarManager } from "./sidecars.js";

export interface HubHost {
  readonly admission: AdmissionGate;
  readonly credentials: CredentialStore | null;
  readonly frameKeys: FrameKeys;
  readonly hubHome: string;
  readonly keepAlive: boolean;
  readonly listExtensions: ListExtensions;
  readonly registryPath: string;
  readonly selfBin: string;
  readonly sessionHosts: HubSessionHostPicker;
  readonly sidecars: SidecarManager;
  readonly startedAt: string;
  readonly token: string | null;
  readonly listeningPort: number;
  readonly projectCount: number;

  exitIfEmpty(): void;
  faults(): string[];
  getProject(id: string): ProjectView | null;
  handOverSessions(): number;
  listProjects(): ProjectView[];
  queueSnapshot(projectId?: string): PublicQueueSnapshot;
  registerProject(input: RegisterProjectInput): Promise<{ created: boolean; project: ProjectView }>;
  removeProject(id: string): Promise<boolean>;
  removeWorktree(id: string, worktree: string): Promise<WorktreeRemoval>;
  repairSelfBin(): boolean;
}
