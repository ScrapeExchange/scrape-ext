// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { hasSeen, recordSeen, recordSubmitted, dedupKey } from '~/background/dedup';
import { getJSON } from '~/shared/storage';
import type { DedupRecord } from '~/shared/types';

describe('dedup', () => {
  it('dedupKey produces stable key', () => {
    expect(dedupKey('UCabc')).toBe('dedup:youtube:channel:UCabc');
    expect(dedupKey('@foo')).toBe('dedup:youtube:channel:@foo');
  });

  it('hasSeen returns false for unknown value', async () => {
    expect(await hasSeen('UCnew')).toBe(false);
  });

  it('recordSeen creates dedup record with status=queued', async () => {
    await recordSeen('UCabc');
    expect(await hasSeen('UCabc')).toBe(true);
    const rec = await getJSON<DedupRecord>(dedupKey('UCabc'), null as never);
    expect(rec.status).toBe('queued');
    expect(rec.attempts).toBe(0);
    expect(rec.lastSubmittedAt).toBeNull();
  });

  it('recordSubmitted updates status to accepted and stamps lastSubmittedAt', async () => {
    await recordSeen('UCabc');
    await recordSubmitted('UCabc', 'accepted');
    const rec = await getJSON<DedupRecord>(dedupKey('UCabc'), null as never);
    expect(rec.status).toBe('accepted');
    expect(rec.lastSubmittedAt).toBeTruthy();
  });
});
