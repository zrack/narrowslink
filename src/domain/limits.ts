export const MEBIBYTE = 1024 * 1024;

/**
 * Hard browser safety envelope for canonical v1/v2 replay documents.
 * The release gate exercises the record ceiling with a document larger than
 * the former 32 MiB limit in every supported browser engine.
 */
export const MAX_SESSION_FILE_BYTES = 64 * MEBIBYTE;
export const MAX_SESSION_RECORDS = 200_000;

export const LARGE_SESSION_SUPPORT_TIER = Object.freeze({
  maxCanonicalBytes: MAX_SESSION_FILE_BYTES,
  maxRecords: MAX_SESSION_RECORDS,
  maxDurationHours: 24,
  heartbeatIntervalMs: 25,
  maxMainThreadHeartbeatGapMs: 5_000,
  maxMainThreadDelayRatio: 0.5,
  maxChromiumHeapGrowthBytes: 768 * MEBIBYTE,
});
