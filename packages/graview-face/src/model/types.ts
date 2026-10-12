/*
 * The types of "n-dx" (version 1), written by `graview types ../graview/n-dx.graview.json`.
 * Do not edit: change the document and run it again. Read a store through
 * them with `typedReader<Types>(store)` from "@graview/core/typed".
 */
import type { TypedReader } from "@graview/core/typed";

/** A part of the product, named for the job it does. Holds capabilities and constraints. */
export interface Area {
  readonly id: string;
  readonly kind: "area";
  readonly title: string;
  /** The frozen folder name in the rex tree. */
  readonly slug?: string;
  /** Shown as "Id". */
  readonly displayId?: string;
  readonly summary?: string;
  readonly status?: "pending" | "in_progress" | "completed" | "failing" | "deferred" | "blocked" | "cancelled" | "deleted";
  /** Shown as "Standing". */
  readonly intentStatus?: "proposed" | "changing" | "met" | "revised" | "retired";
  readonly health?: "ok" | "defective";
  /** Drawn from rex's migration plan over a v1 tree, not yet in the PRD. Shown as "Proposed". */
  readonly proposed?: boolean;
  readonly stewards?: readonly string[];
  readonly tags?: readonly string[];
}

/** A standing requirement: what the product does, with the criteria that say when it is met. */
export interface Capability {
  readonly id: string;
  readonly kind: "capability";
  readonly title: string;
  readonly slug?: string;
  /** Shown as "Id". */
  readonly displayId?: string;
  readonly statement?: string;
  readonly status?: "pending" | "in_progress" | "completed" | "failing" | "deferred" | "blocked" | "cancelled" | "deleted";
  /** Shown as "Standing". */
  readonly intentStatus?: "proposed" | "changing" | "met" | "revised" | "retired";
  readonly health?: "ok" | "defective";
  /** Drawn from rex's migration plan over a v1 tree, not yet in the PRD. Shown as "Proposed". */
  readonly proposed?: boolean;
  /** Shown as "Criteria". */
  readonly criteriaCount?: number;
  /** A person reviewed the current spec. */
  readonly reviewed?: boolean;
  readonly tags?: readonly string[];
}

/** A standing rule the product must keep, binding the nodes it applies to. */
export interface Constraint {
  readonly id: string;
  readonly kind: "constraint";
  readonly title: string;
  readonly slug?: string;
  /** Shown as "Id". */
  readonly displayId?: string;
  readonly statement?: string;
  readonly status?: "pending" | "in_progress" | "completed" | "failing" | "deferred" | "blocked" | "cancelled" | "deleted";
  /** Shown as "Standing". */
  readonly intentStatus?: "proposed" | "changing" | "met" | "revised" | "retired";
  readonly health?: "ok" | "defective";
  /** Drawn from rex's migration plan over a v1 tree, not yet in the PRD. Shown as "Proposed". */
  readonly proposed?: boolean;
  /** Shown as "Binds everything". */
  readonly appliesToAll?: boolean;
  readonly tags?: readonly string[];
}

/** A unit of intent: why something is changing, what it amends or touches, and when it is planned to ship. */
export interface Change {
  readonly id: string;
  readonly kind: "change";
  readonly title: string;
  readonly slug?: string;
  /** Shown as "Id". */
  readonly displayId?: string;
  readonly intent?: string;
  readonly status?: "pending" | "in_progress" | "completed" | "failing" | "deferred" | "blocked" | "cancelled" | "deleted";
  readonly priority?: "critical" | "high" | "medium" | "low";
  /** Shown as "Kind". */
  readonly changeKind?: "feature" | "enhancement" | "retirement" | "fix" | "refactor" | "policy-change" | "spike";
  /** What this change was on a v1 tree. */
  readonly level?: "epic" | "feature" | "change";
  readonly fix?: boolean;
  readonly spike?: boolean;
  /** Waiting for a person to confirm what it targets. */
  readonly inbox?: boolean;
  /** Shown as "Planned for". */
  readonly plannedRelease?: string;
  /** Shown as "Shipped in". */
  readonly shippedIn?: string;
  readonly assignee?: string;
  /** Shown as "Started". A date and time, as ISO 8601. */
  readonly startedAt?: string;
  /** Shown as "Closed". A date and time, as ISO 8601. */
  readonly completedAt?: string;
  readonly tags?: readonly string[];
  /** When rex last wrote this; the version a two-way sync agrees on. Shown as "Last changed". A date and time, as ISO 8601. */
  readonly lastModified?: string;
  /** Shown as "Last changed by". */
  readonly lastModifiedBy?: string;
}

/** A piece of a change small enough to run: the unit ndx work picks up. */
export interface Task {
  readonly id: string;
  readonly kind: "task";
  readonly title: string;
  readonly slug?: string;
  /** Shown as "Id". */
  readonly displayId?: string;
  readonly description?: string;
  readonly status?: "pending" | "in_progress" | "completed" | "failing" | "deferred" | "blocked" | "cancelled" | "deleted";
  readonly priority?: "critical" | "high" | "medium" | "low";
  readonly level?: "task" | "subtask";
  readonly assignee?: string;
  /** Shown as "Started". A date and time, as ISO 8601. */
  readonly startedAt?: string;
  /** Shown as "Closed". A date and time, as ISO 8601. */
  readonly completedAt?: string;
  readonly tags?: readonly string[];
  /** When rex last wrote this; the version a two-way sync agrees on. Shown as "Last changed". A date and time, as ISO 8601. */
  readonly lastModified?: string;
  /** Shown as "Last changed by". */
  readonly lastModifiedBy?: string;
}

/** A version changes are planned for or shipped in, or that git tagged. Never a container: a field on the change and a tag in git, read here as a node so the plan can be drawn. */
export interface Release {
  readonly id: string;
  readonly kind: "release";
  readonly version: string;
  /** Shown as "Planned". */
  readonly plannedChanges?: number;
  /** Shown as "Shipped". */
  readonly shippedChanges?: number;
  /** Shown as "Tagged". A date and time, as ISO 8601. */
  readonly taggedAt?: string;
}

/** An architectural zone sourcevision found: files that belong together, with how tightly they hold and how much they lean on others. */
export interface Zone {
  readonly id: string;
  readonly kind: "zone";
  readonly name: string;
  readonly description?: string;
  readonly cohesion?: number;
  readonly coupling?: number;
  /** Shown as "Files". */
  readonly fileCount?: number;
  readonly depth?: number;
  /** Shown as "Entry points". */
  readonly entryPoints?: readonly string[];
}

/** A UI component sourcevision catalogued, standing in the zone its file belongs to. */
export interface Component {
  readonly id: string;
  readonly kind: "component";
  readonly name: string;
  readonly file?: string;
  /** What sourcevision classified it as. */
  readonly role?: string;
  readonly line?: number;
}

/** A source file, with the commits that changed it and the capabilities whose work did. Kept off the map's bar: reach one from its zone, a capability or a commit. */
export interface File {
  readonly id: string;
  readonly kind: "file";
  readonly path: string;
  readonly language?: string;
  readonly role?: string;
  /** Shown as "Lines". */
  readonly lineCount?: number;
}

/** One agent run hench recorded: the task it worked, what it cost, and what it committed. */
export interface Run {
  readonly id: string;
  readonly kind: "run";
  /** Shown as "Worked on". */
  readonly taskTitle: string;
  readonly status?: "running" | "completed" | "failed" | "timeout" | "budget_exceeded" | "error_transient" | "cancelled";
  readonly vendor?: string;
  readonly model?: string;
  /** Shown as "Started". A date and time, as ISO 8601. */
  readonly startedAt?: string;
  /** Shown as "Finished". A date and time, as ISO 8601. */
  readonly finishedAt?: string;
  readonly turns?: number;
  readonly tokens?: number;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  /** Shown as "Files changed". */
  readonly filesChanged?: number;
  readonly branch?: string;
}

/** A commit on main tied to the work it was for: by its N-DX-Item trailer, or by the run record that names it. */
export interface Commit {
  readonly id: string;
  readonly kind: "commit";
  readonly sha: string;
  readonly subject?: string;
  readonly author?: string;
  /** Shown as "Committed". A date and time, as ISO 8601. */
  readonly committedAt?: string;
  /** How the commit was tied to its work: trailer, the N-DX-Item trailer names it; start-head, the run that made it recorded it as it ended; subject, trailer or window, hench backfill-commits read it from history. Shown as "Tied by". */
  readonly attribution?: "trailer" | "start-head" | "subject" | "window";
}

/** Every kind's record, by kind. */
export type Kinds = {
  readonly area: Area;
  readonly capability: Capability;
  readonly constraint: Constraint;
  readonly change: Change;
  readonly task: Task;
  readonly release: Release;
  readonly zone: Zone;
  readonly component: Component;
  readonly file: File;
  readonly run: Run;
  readonly commit: Commit;
};

/** The kinds each kind's relations reach, by kind and relation. */
export type Edges = {
  readonly area: {
    /** the area this sits inside */
    readonly under: "area";
  };
  readonly capability: {
    /** the area or capability this sits inside */
    readonly under: "area" | "capability";
    /** the capabilities this one needs */
    readonly dependsOn: "capability";
    /** the code zones changed by the work placed on this capability */
    readonly realizedIn: "zone";
    /** the files changed by the work placed on this capability */
    readonly livesIn: "file";
  };
  readonly constraint: {
    /** what this constraint sits inside */
    readonly under: "area" | "capability" | "constraint";
    /** the product nodes this constraint binds */
    readonly appliesTo: "capability" | "area" | "constraint";
  };
  readonly change: {
    /** the change this sits inside */
    readonly under: "change";
    /** the product nodes this change rewrites */
    readonly amends: "capability" | "constraint" | "area";
    /** the product nodes this change works on without rewriting them */
    readonly touches: "capability" | "constraint" | "area";
    /** what has to finish first */
    readonly blockedBy: "change" | "task";
    /** the work that surfaced this change */
    readonly discoveredFrom: "change" | "task" | "run";
    /** the release this change is planned for */
    readonly plannedFor: "release";
    /** the release this change shipped in */
    readonly shippedWith: "release";
  };
  readonly task: {
    /** the change or task this runs under */
    readonly under: "change" | "task";
    /** what has to finish first */
    readonly blockedBy: "change" | "task";
  };
  readonly release: {};
  readonly zone: {
    /** the zone this sits inside */
    readonly under: "zone";
    /** the zones this one imports from */
    readonly crosses: "zone";
  };
  readonly component: {
    /** the zone this lives in */
    readonly inZone: "zone";
  };
  readonly file: {
    /** the zone this lives in */
    readonly inZone: "zone";
  };
  readonly run: {
    /** the work this run was for */
    readonly ranFor: "change" | "task";
    /** the commits this run made */
    readonly produced: "commit";
  };
  readonly commit: {
    /** the work this commit landed for */
    readonly landedFor: "change" | "task";
    /** the capabilities the work this commit landed for was placed on */
    readonly realizes: "capability";
    /** the files this commit changed */
    readonly changed: "file";
  };
};

/** The document's types: what `typedReader` reads a store through. */
export type Types = { readonly kinds: Kinds; readonly edges: Edges };
/** A record of any kind. */
export type AnyRecord = Kinds[keyof Kinds];
/** A store read through these types: `typedReader<Types>(store)`. */
export type Reader = TypedReader<Types>;
