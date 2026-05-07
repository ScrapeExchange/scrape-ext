// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { runPrune } from '~/background/prune';
import { recordHistory } from '~/background/history';
import { recordSeen, hasSeen } from '~/background/dedup';
import { listHistory } from '~/background/history';
import type { QueueItem } from '~/shared/types';

function makeItem(id: string, enqueuedAt: string): QueueItem {
  return {
    id,
    platform: 'youtube',
    entity: 'channel',
    kind: 'channel_id',
    rawValue: `UC${id.padEnd(22, 'a')}`,
    apiContent: `UC${id.padEnd(22, 'a')}`,
    enqueuedAt,
    attempts: 0,
    nextAttemptAt: null,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-05-07T12:00:00Z'));
});

describe('runPrune', () => {
  it('removes history entries older than 90 days, keeps newer', async () => {
    const old = new Date('2026-02-01T00:00:00Z').toISOString();
    const recent = new Date('2026-05-01T00:00:00Z').toISOString();
    await recordHistory(makeItem('old', old), 'accepted');
    await recordHistory(makeItem('new', recent), 'accepted');
    await runPrune();
    const hist = await listHistory();
    expect(hist.find((h) => h.id === 'old')).toBeUndefined();
    expect(hist.find((h) => h.id === 'new')).toBeDefined();
  });

  it('removes dedup records older than 90 days', async () => {
    vi.setSystemTime(new Date('2026-02-01T00:00:00Z'));
    await recordSeen('UCold');
    vi.setSystemTime(new Date('2026-05-07T12:00:00Z'));
    await recordSeen('UCnew');
    await runPrune();
    expect(await hasSeen('UCold')).toBe(false);
    expect(await hasSeen('UCnew')).toBe(true);
  });
});
