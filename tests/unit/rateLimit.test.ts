// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { canSubmitNow, recordSubmission, nextAvailableAt } from '~/background/rateLimit';
import { RATE_LIMIT_PER_HOUR, RATE_LIMIT_PER_MINUTE } from '~/shared/constants';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-05-07T12:00:00Z'));
});

describe('rateLimit', () => {
  it('canSubmitNow is true on a fresh window', async () => {
    expect(await canSubmitNow()).toBe(true);
  });

  it('canSubmitNow is false after RATE_LIMIT_PER_MINUTE submissions in last 60s', async () => {
    for (let i = 0; i < RATE_LIMIT_PER_MINUTE; i++) {
      await recordSubmission();
    }
    expect(await canSubmitNow()).toBe(false);
  });

  it('rolls forward after the per-minute window passes', async () => {
    for (let i = 0; i < RATE_LIMIT_PER_MINUTE; i++) {
      await recordSubmission();
    }
    vi.setSystemTime(new Date('2026-05-07T12:01:01Z'));
    expect(await canSubmitNow()).toBe(true);
  });

  it('blocks at the per-hour limit even when per-minute is open', async () => {
    for (let i = 0; i < RATE_LIMIT_PER_HOUR; i++) {
      await recordSubmission();
      vi.setSystemTime(new Date(Date.now() + 1_000));
    }
    expect(await canSubmitNow()).toBe(false);
  });

  it('nextAvailableAt returns ms-since-epoch when blocked', async () => {
    for (let i = 0; i < RATE_LIMIT_PER_MINUTE; i++) {
      await recordSubmission();
    }
    const next = await nextAvailableAt();
    expect(next).not.toBeNull();
    expect(next!).toBeGreaterThan(Date.now());
  });

  it('nextAvailableAt returns null when not blocked', async () => {
    expect(await nextAvailableAt()).toBeNull();
  });
});
