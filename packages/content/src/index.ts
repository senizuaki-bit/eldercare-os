/** External content source contracts only. Fetching and review behavior are deferred to M12. */
export interface ContentFetchInput {
  readonly cursor?: string;
  readonly limit: number;
  readonly region?: string;
}

export interface ContentCandidate {
  readonly externalId: string;
  readonly sourceName: string;
  readonly sourceUrlOrReference: string;
  readonly title: string;
  readonly body: string;
  readonly publishedAt: string;
  readonly fetchedAt: string;
  readonly region?: string;
  readonly contentType: string;
}

export interface ContentSourceProvider {
  fetchCandidates(input: ContentFetchInput): Promise<readonly ContentCandidate[]>;
}
