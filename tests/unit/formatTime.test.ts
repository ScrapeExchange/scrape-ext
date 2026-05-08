import { describe, it, expect } from 'vitest';
import { formatAmsterdamWithUTC } from '~/popup/formatTime';

describe('formatAmsterdamWithUTC', () => {
  it('formats summer (CEST = UTC+2)', () => {
    expect(formatAmsterdamWithUTC('2026-05-07T12:00:00Z'))
      .toBe('2026-05-07 14:00 (12:00 UTC)');
  });

  it('formats winter (CET = UTC+1)', () => {
    expect(formatAmsterdamWithUTC('2026-12-15T08:30:00Z'))
      .toBe('2026-12-15 09:30 (08:30 UTC)');
  });

  it('returns empty string for invalid input', () => {
    expect(formatAmsterdamWithUTC('not-a-date')).toBe('');
  });
});
