export type CodecovTestRunRow = {
  filename?: string | null | undefined;
  commit_sha?: string | null | undefined;
  duration_seconds?: number | null | undefined;
};

export declare const RETRYABLE_STATUS: ReadonlySet<number>;

export declare function shouldRetryCodecovFetch(
  status: number,
  attempt: number,
  maxAttempts: number,
): boolean;

export declare function aggregateByFile(rows: CodecovTestRunRow[]): Record<string, number>;
