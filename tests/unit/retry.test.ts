// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import { scheduleRetry, isRetryAlarm, alarmIdToItemId } from '~/background/retry';
import { RETRY_BACKOFF_MS, MAX_RETRY_ATTEMPTS, RETRY_ALARM_PREFIX } from '~/shared/constants';
import type { QueueItem } from '~/shared/types';

function item(attempts: number): QueueItem {
  return {
    id: 'qid',
    platform: 'youtube',
    entity: 'channel',
    kind: 'channel_id',
    rawValue: 'UCBJycsmduvYEL83R_U4JriQ',
    apiContent: 'UCBJycsmduvYEL83R_U4JriQ',
    enqueuedAt: new Date().toISOString(),
    attempts,
    nextAttemptAt: null,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-05-07T12:00:00Z'));
});

describe('scheduleRetry', () => {
  it('schedules an alarm at now+backoff[attempts] when attempts < MAX', async () => {
    const result = await scheduleRetry(item(0));
    expect(result.scheduled).toBe(true);
    const alarms = await fakeBrowser.alarms.getAll();
    expect(alarms).toHaveLength(1);
    expect(alarms[0]!.name).toBe(`${RETRY_ALARM_PREFIX}qid`);
    expect(alarms[0]!.scheduledTime).toBe(Date.now() + RETRY_BACKOFF_MS[0]);
  });

  it('uses backoff[1] for second attempt', async () => {
    await scheduleRetry(item(1));
    const alarms = await fakeBrowser.alarms.getAll();
    expect(alarms[0]!.scheduledTime).toBe(Date.now() + RETRY_BACKOFF_MS[1]);
  });

  it('returns scheduled=false when attempts >= MAX', async () => {
    const result = await scheduleRetry(item(MAX_RETRY_ATTEMPTS));
    expect(result.scheduled).toBe(false);
    expect(await fakeBrowser.alarms.getAll()).toHaveLength(0);
  });
});

describe('isRetryAlarm / alarmIdToItemId', () => {
  it('detects retry alarm prefix', () => {
    expect(isRetryAlarm(`${RETRY_ALARM_PREFIX}xyz`)).toBe(true);
    expect(isRetryAlarm('prune')).toBe(false);
  });

  it('extracts item id from alarm name', () => {
    expect(alarmIdToItemId(`${RETRY_ALARM_PREFIX}xyz`)).toBe('xyz');
  });
});
