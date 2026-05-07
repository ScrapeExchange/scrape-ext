import { browser } from 'wxt/browser';
import {
  MAX_RETRY_ATTEMPTS,
  RETRY_ALARM_PREFIX,
  RETRY_BACKOFF_MS,
} from '~/shared/constants';
import type { QueueItem } from '~/shared/types';

export interface ScheduleResult {
  scheduled: boolean;
  whenMs?: number;
}

export async function scheduleRetry(item: QueueItem): Promise<ScheduleResult> {
  if (item.attempts >= MAX_RETRY_ATTEMPTS) return { scheduled: false };
  const delay = RETRY_BACKOFF_MS[item.attempts]!;
  const when = Date.now() + delay;
  await browser.alarms.create(`${RETRY_ALARM_PREFIX}${item.id}`, { when });
  return { scheduled: true, whenMs: when };
}

export function isRetryAlarm(name: string): boolean {
  return name.startsWith(RETRY_ALARM_PREFIX);
}

export function alarmIdToItemId(name: string): string {
  return name.slice(RETRY_ALARM_PREFIX.length);
}
