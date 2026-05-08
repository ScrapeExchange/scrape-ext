// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import { drainOnce } from '~/background/drain';
import { enqueue, size } from '~/background/queue';
import { listHistory, recordHistory } from '~/background/history';
import { DRAIN_ALARM_NAME, RATE_LIMIT_PER_MINUTE, RETRY_ALARM_PREFIX } from '~/shared/constants';
import { recordSubmission } from '~/background/rateLimit';
import type { QueueItem } from '~/shared/types';

const fetchMock = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-05-07T12:00:00Z'));
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
});

function item(id: string, attempts = 0): QueueItem {
  return {
    id,
    platform: 'youtube',
    entity: 'channel',
    kind: 'channel_id',
    rawValue: `UC${id}aaaaaaaaaaaaaaaaaaaaaa`.slice(0, 24),
    apiContent: `UC${id}aaaaaaaaaaaaaaaaaaaaaa`.slice(0, 24),
    enqueuedAt: new Date().toISOString(),
    attempts,
    nextAttemptAt: null,
  };
}

async function enqueueWithHistory(it: QueueItem): Promise<void> {
  await enqueue(it);
  await recordHistory(it, 'queued');
}

describe('drainOnce', () => {
  it('does nothing when queue empty', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 201 }));
    await drainOnce();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('submits head of queue, removes it on accept, records history', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 201 }));
    await enqueueWithHistory(item('a'));
    await drainOnce();
    expect(await size()).toBe(0);
    const hist = await listHistory();
    expect(hist[0]?.status).toBe('accepted');
  });

  it('on retry outcome: schedules retry alarm and removes from queue', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 503 }));
    await enqueueWithHistory(item('a', 0));
    await drainOnce();
    expect(await size()).toBe(0);
    const alarms = await fakeBrowser.alarms.getAll();
    expect(alarms.some((a: { name: string }) => a.name === `${RETRY_ALARM_PREFIX}a`)).toBe(true);
    const hist = await listHistory();
    expect(hist[0]?.status).toBe('retrying');
  });

  it('on terminal outcome: removes from queue, marks failed in history', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 422 }));
    await enqueueWithHistory(item('a'));
    await drainOnce();
    expect(await size()).toBe(0);
    const hist = await listHistory();
    expect(hist[0]?.status).toBe('failed');
  });

  it('when rate-limited: schedules drain alarm at next-available time, leaves queue', async () => {
    for (let i = 0; i < RATE_LIMIT_PER_MINUTE; i++) await recordSubmission();
    await enqueueWithHistory(item('a'));
    await drainOnce();
    expect(await size()).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
    const alarms = await fakeBrowser.alarms.getAll();
    expect(alarms.some((a: { name: string }) => a.name === DRAIN_ALARM_NAME)).toBe(true);
  });

  it('after MAX retry attempts on retry outcome: marks failed, no alarm', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 503 }));
    await enqueueWithHistory(item('a', 4));
    await drainOnce();
    const hist = await listHistory();
    expect(hist[0]?.status).toBe('failed');
    const alarms = await fakeBrowser.alarms.getAll();
    expect(alarms.some((a: { name: string }) => a.name === `${RETRY_ALARM_PREFIX}a`)).toBe(false);
  });
});
