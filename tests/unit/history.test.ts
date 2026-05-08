// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { recordHistory, listHistory, updateHistoryStatus } from '~/background/history';
import { HISTORY_CAP } from '~/shared/constants';
import type { QueueItem } from '~/shared/types';

function item(id: string): QueueItem {
  return {
    id,
    platform: 'youtube',
    entity: 'channel',
    kind: 'channel_id',
    rawValue: `UC${id.padEnd(22, 'a')}`,
    apiContent: `UC${id.padEnd(22, 'a')}`,
    enqueuedAt: new Date().toISOString(),
    attempts: 0,
    nextAttemptAt: null,
  };
}

describe('history', () => {
  it('starts empty', async () => {
    expect(await listHistory()).toEqual([]);
  });

  it('recordHistory prepends the entry', async () => {
    await recordHistory(item('1'), 'queued');
    await recordHistory(item('2'), 'queued');
    const list = await listHistory();
    expect(list[0]?.id).toBe('2');
    expect(list[1]?.id).toBe('1');
  });

  it('caps history at HISTORY_CAP entries', async () => {
    for (let i = 0; i < HISTORY_CAP + 5; i++) {
      await recordHistory(item(String(i)), 'queued');
    }
    const list = await listHistory();
    expect(list.length).toBe(HISTORY_CAP);
    expect(list[0]?.id).toBe(String(HISTORY_CAP + 4));
  });

  it('updateHistoryStatus mutates matching id, leaves others alone', async () => {
    await recordHistory(item('1'), 'queued');
    await recordHistory(item('2'), 'queued');
    await updateHistoryStatus('1', 'accepted');
    const list = await listHistory();
    const e1 = list.find((e) => e.id === '1');
    const e2 = list.find((e) => e.id === '2');
    expect(e1?.status).toBe('accepted');
    expect(e1?.acceptedAt).toBeTruthy();
    expect(e2?.status).toBe('queued');
  });
});
