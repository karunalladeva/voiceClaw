export interface EvidenceFact {
  id: string;
  claim: string;
  source: string;
  url?: string;
  pointerId?: string;
  fetchedAt: string;
  verified?: boolean;
}

export interface EvidenceBundle {
  scopeId: string;
  facts: EvidenceFact[];
  createdAt: string;
}
