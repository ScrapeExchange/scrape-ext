export type Platform = 'youtube';
export type Entity = 'channel';
export type IdentifierKind = 'channel_id' | 'handle';
export type SubmissionStatus =
  | 'queued'
  | 'retrying'
  | 'accepted'
  | 'failed';

export interface QueueItem {
  id: string;
  platform: Platform;
  entity: Entity;
  kind: IdentifierKind;
  rawValue: string;
  apiContent: string;
  enqueuedAt: string;
  attempts: number;
  nextAttemptAt: string | null;
}

export interface HistoryEntry extends QueueItem {
  status: SubmissionStatus;
  lastError?: string;
  acceptedAt?: string;
}

export interface DedupRecord {
  firstSeen: string;
  lastSubmittedAt: string | null;
  status: SubmissionStatus;
  attempts: number;
}

export interface RateWindow {
  perMinute: number[];
  perHour: number[];
}

export interface CandidateMessage {
  type: 'youtube/channel-candidate';
  channel_id?: string;
  handle?: string;
  sourceUrl: string;
}
