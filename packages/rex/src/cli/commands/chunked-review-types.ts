import type { ItemStatus } from "../../schema/index.js";

export type ProposalItemStatus = ItemStatus;

export interface ProposalTask {
  title: string;
  source: string;
  sourceFile: string;
  description?: string;
  acceptanceCriteria?: string[];
  priority?: string;
  tags?: string[];
  status?: ProposalItemStatus;
  loe?: number;
  loeRationale?: string;
  loeConfidence?: "low" | "medium" | "high";
  decomposition?: TaskDecomposition;
}

export interface TaskDecomposition {
  children: ProposalTask[];
  thresholdWeeks: number;
}

export interface ProposalFeature {
  title: string;
  source: string;
  description?: string;
  status?: ProposalItemStatus;
  tasks: ProposalTask[];
  existingId?: string;
}

export interface ProposalEpic {
  title: string;
  source: string;
  description?: string;
  status?: ProposalItemStatus;
  existingId?: string;
}

export interface Proposal {
  epic: ProposalEpic;
  features: ProposalFeature[];
}
