import { RETENTION_DAYS, STORAGE_KEYS } from '~/shared/constants';
import { getJSON, listKeysWithPrefix, removeKey, setJSON } from '~/shared/storage';
import type { DedupRecord, HistoryEntry } from '~/shared/types';

const DAY_MS = 86_400_000;

function tooOld(iso: string, now: number): boolean {
  return Date.parse(iso) < now - RETENTION_DAYS * DAY_MS;
}

export async function runPrune(): Promise<void> {
  const now = Date.now();

  const history = await getJSON<HistoryEntry[]>(STORAGE_KEYS.history, []);
  const filteredHistory = history.filter((e) => !tooOld(e.enqueuedAt, now));
  await setJSON(STORAGE_KEYS.history, filteredHistory);

  const dedupKeys = await listKeysWithPrefix(STORAGE_KEYS.dedupPrefix);
  for (const key of dedupKeys) {
    const rec = await getJSON<DedupRecord | null>(key, null);
    if (!rec) continue;
    const last = rec.lastSubmittedAt;
    const tooOldSeen = tooOld(rec.firstSeen, now);
    const tooOldSubmitted = last === null ? true : tooOld(last, now);
    if (tooOldSeen && tooOldSubmitted) {
      await removeKey(key);
    }
  }
}
