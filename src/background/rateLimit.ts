import {
  RATE_LIMIT_PER_HOUR,
  RATE_LIMIT_PER_MINUTE,
  STORAGE_KEYS,
} from '../shared/constants';
import { getJSON, setJSON } from '../shared/storage';
import type { RateWindow } from '../shared/types';

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;

async function load(): Promise<RateWindow> {
  return await getJSON<RateWindow>(STORAGE_KEYS.rateWindow, {
    perMinute: [],
    perHour: [],
  });
}

async function save(window: RateWindow): Promise<void> {
  await setJSON(STORAGE_KEYS.rateWindow, window);
}

function prune(window: RateWindow, now: number): RateWindow {
  return {
    perMinute: window.perMinute.filter((ts) => ts > now - MINUTE_MS),
    perHour: window.perHour.filter((ts) => ts > now - HOUR_MS),
  };
}

export async function canSubmitNow(): Promise<boolean> {
  const now = Date.now();
  const w = prune(await load(), now);
  return (
    w.perMinute.length < RATE_LIMIT_PER_MINUTE
    && w.perHour.length < RATE_LIMIT_PER_HOUR
  );
}

export async function recordSubmission(): Promise<void> {
  const now = Date.now();
  const w = prune(await load(), now);
  w.perMinute.push(now);
  w.perHour.push(now);
  await save(w);
}

export async function nextAvailableAt(): Promise<number | null> {
  const now = Date.now();
  const w = prune(await load(), now);

  let earliest: number | null = null;
  if (w.perMinute.length >= RATE_LIMIT_PER_MINUTE) {
    const oldest = w.perMinute[0]!;
    earliest = oldest + MINUTE_MS;
  }
  if (w.perHour.length >= RATE_LIMIT_PER_HOUR) {
    const oldest = w.perHour[0]!;
    const cap = oldest + HOUR_MS;
    earliest = earliest === null ? cap : Math.min(earliest, cap);
  }
  return earliest;
}
