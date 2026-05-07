import { HISTORY_CAP, STORAGE_KEYS } from '~/shared/constants';
import { getJSON, setJSON } from '~/shared/storage';
import type {
  HistoryEntry,
  QueueItem,
  SubmissionStatus,
} from '~/shared/types';

async function load(): Promise<HistoryEntry[]> {
  return await getJSON<HistoryEntry[]>(STORAGE_KEYS.history, []);
}

async function save(entries: HistoryEntry[]): Promise<void> {
  await setJSON(STORAGE_KEYS.history, entries);
}

export async function recordHistory(
  item: QueueItem,
  status: SubmissionStatus,
  lastError?: string,
): Promise<void> {
  const entries = await load();
  const entry: HistoryEntry = { ...item, status, lastError };
  entries.unshift(entry);
  if (entries.length > HISTORY_CAP) entries.length = HISTORY_CAP;
  await save(entries);
}

export async function updateHistoryStatus(
  id: string,
  status: SubmissionStatus,
  lastError?: string,
): Promise<void> {
  const entries = await load();
  const idx = entries.findIndex((e) => e.id === id);
  if (idx === -1) return;
  const updated: HistoryEntry = {
    ...entries[idx]!,
    status,
    lastError: lastError ?? entries[idx]!.lastError,
    acceptedAt:
      status === 'accepted' ? new Date().toISOString() : entries[idx]!.acceptedAt,
  };
  entries[idx] = updated;
  await save(entries);
}

export async function listHistory(): Promise<HistoryEntry[]> {
  return await load();
}
