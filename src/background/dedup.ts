import { STORAGE_KEYS } from '../shared/constants';
import { getJSON, removeKey, setJSON } from '../shared/storage';
import type { DedupRecord, SubmissionStatus } from '../shared/types';

export function dedupKey(rawValue: string): string {
  return `${STORAGE_KEYS.dedupPrefix}${rawValue}`;
}

export async function hasSeen(rawValue: string): Promise<boolean> {
  const rec = await getJSON<DedupRecord | null>(dedupKey(rawValue), null);
  return rec !== null;
}

export async function recordSeen(rawValue: string): Promise<void> {
  const now = new Date().toISOString();
  const record: DedupRecord = {
    firstSeen: now,
    lastSubmittedAt: null,
    status: 'queued',
    attempts: 0,
  };
  await setJSON(dedupKey(rawValue), record);
}

export async function recordSubmitted(
  rawValue: string,
  status: SubmissionStatus,
  lastError?: string,
): Promise<void> {
  const key = dedupKey(rawValue);
  const existing = await getJSON<DedupRecord | null>(key, null);
  if (!existing) return;
  const updated: DedupRecord = {
    ...existing,
    status,
    lastSubmittedAt: new Date().toISOString(),
    attempts: existing.attempts + (status === 'retrying' ? 1 : 0),
  };
  void lastError;
  await setJSON(key, updated);
}

export async function deleteDedup(rawValue: string): Promise<void> {
  await removeKey(dedupKey(rawValue));
}
