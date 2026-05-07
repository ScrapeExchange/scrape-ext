import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import { _internal, registerHandlers } from '~/background/router';
import { listHistory } from '~/background/history';
import { RETRY_ALARM_PREFIX } from '~/shared/constants';

const fetchMock = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-05-07T12:00:00Z'));
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  registerHandlers();
});

async function drainAllRetryAlarms(): Promise<number> {
  let fired = 0;
  while (true) {
    const all = await fakeBrowser.alarms.getAll();
    const retry = all.find((a: { name: string }) => a.name.startsWith(RETRY_ALARM_PREFIX));
    if (!retry) return fired;
    const itemId = retry.name.slice(RETRY_ALARM_PREFIX.length);
    await fakeBrowser.alarms.clear(retry.name);
    await _internal.handleRetryAlarm(itemId);
    fired++;
  }
}

describe('failure-path: 503 retries then fails after MAX attempts', () => {
  it('first 503 schedules retry alarm and history shows retrying', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 503 }));
    await _internal.handleCandidate({
      type: 'youtube/channel-candidate',
      channel_id: 'UCBJycsmduvYEL83R_U4JriQ',
      sourceUrl: 'https://www.youtube.com/',
    });
    const hist = await listHistory();
    expect(hist[0]?.status).toBe('retrying');
    const alarms = await fakeBrowser.alarms.getAll();
    expect(alarms.some((a: { name: string }) => a.name.startsWith(RETRY_ALARM_PREFIX))).toBe(true);
  });

  it('fails terminally after exhausting retries', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 503 }));
    await _internal.handleCandidate({
      type: 'youtube/channel-candidate',
      channel_id: 'UCBJycsmduvYEL83R_U4JriQ',
      sourceUrl: 'https://www.youtube.com/',
    });
    // Initial submit was attempt 1. Each retry alarm = one more attempt.
    // Drain all retry alarms; once attempts reaches MAX, no further alarm
    // is scheduled and history is marked failed.
    await drainAllRetryAlarms();
    const hist = await listHistory();
    expect(hist[0]?.status).toBe('failed');
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('422 marks failed immediately (terminal)', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 422 }));
    await _internal.handleCandidate({
      type: 'youtube/channel-candidate',
      handle: '@MrBeast',
      sourceUrl: 'https://www.youtube.com/',
    });
    const hist = await listHistory();
    expect(hist[0]?.status).toBe('failed');
    const alarms = await fakeBrowser.alarms.getAll();
    expect(alarms.some((a: { name: string }) => a.name.startsWith(RETRY_ALARM_PREFIX))).toBe(false);
  });
});
