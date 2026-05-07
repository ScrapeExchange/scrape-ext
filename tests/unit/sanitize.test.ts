import { describe, it, expect } from 'vitest';
import { toApiContent } from '~/shared/sanitize';

describe('toApiContent', () => {
  it('returns channel_id verbatim when valid', () => {
    expect(toApiContent('channel_id', 'UCBJycsmduvYEL83R_U4JriQ'))
      .toBe('UCBJycsmduvYEL83R_U4JriQ');
  });

  it('strips leading @ from handle', () => {
    expect(toApiContent('handle', '@MrBeast')).toBe('MrBeast');
  });

  it('rejects channel_id that does not match UC pattern', () => {
    expect(toApiContent('channel_id', 'XX123')).toBeNull();
  });

  it('rejects handle without leading @', () => {
    expect(toApiContent('handle', 'MrBeast')).toBeNull();
  });

  it('rejects handle whose stripped form contains characters outside API regex', () => {
    expect(toApiContent('handle', '@hank.green')).toBeNull();
  });

  it('rejects empty input', () => {
    expect(toApiContent('handle', '@')).toBeNull();
    expect(toApiContent('channel_id', '')).toBeNull();
  });

  it('rejects oversized values (>32 chars after strip)', () => {
    const tooLong = '@' + 'a'.repeat(33);
    expect(toApiContent('handle', tooLong)).toBeNull();
  });
});
