export const SCHEMA_VERSION = 1;

export const API_BASE = 'https://scrape.exchange';
export const API_REQUEST_PATH = '/api/v1/request';

export const RATE_LIMIT_PER_MINUTE = 100;
export const RATE_LIMIT_PER_HOUR = 1000;

export const RETRY_BACKOFF_MS = [
  60_000,
  300_000,
  1_800_000,
  7_200_000,
] as const;
export const MAX_RETRY_ATTEMPTS = RETRY_BACKOFF_MS.length;

export const HISTORY_CAP = 200;
export const RETENTION_DAYS = 90;

export const PRUNE_ALARM_NAME = 'prune';
export const DRAIN_ALARM_NAME = 'drain';
export const RETRY_ALARM_PREFIX = 'retry:';

export const CHANNEL_ID_RE = /^UC[A-Za-z0-9_-]{22}$/;
export const HANDLE_RE = /^@[A-Za-z0-9._-]{1,30}$/;
export const API_CONTENT_RE = /^[a-zA-Z0-9:/\\\-_ ]+$/;

export const STORAGE_KEYS = {
  schemaVersion: 'schemaVersion',
  queue: 'queue',
  history: 'history',
  rateWindow: 'rateWindow',
  dedupPrefix: 'dedup:youtube:channel:',
} as const;
