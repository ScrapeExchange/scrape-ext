import { describe, it, expect } from 'vitest';
import { extractFromUrl } from '~/content/extract';

describe('extractFromUrl', () => {
  it('extracts channel_id from /channel/UC… path', () => {
    expect(
      extractFromUrl('https://www.youtube.com/channel/UCBJycsmduvYEL83R_U4JriQ'),
    ).toEqual({ channel_id: 'UCBJycsmduvYEL83R_U4JriQ' });
  });

  it('extracts handle from /@handle path', () => {
    expect(
      extractFromUrl('https://www.youtube.com/@MrBeast'),
    ).toEqual({ handle: '@MrBeast' });
  });

  it('extracts handle when followed by /videos', () => {
    expect(
      extractFromUrl('https://www.youtube.com/@MrBeast/videos'),
    ).toEqual({ handle: '@MrBeast' });
  });

  it('extracts handle when followed by ?si=…', () => {
    expect(
      extractFromUrl('https://www.youtube.com/@MrBeast?si=abc'),
    ).toEqual({ handle: '@MrBeast' });
  });

  it('returns empty for /c/<name>', () => {
    expect(
      extractFromUrl('https://www.youtube.com/c/Apple'),
    ).toEqual({});
  });

  it('returns empty for /user/<name>', () => {
    expect(
      extractFromUrl('https://www.youtube.com/user/Apple'),
    ).toEqual({});
  });

  it('returns empty for watch pages', () => {
    expect(
      extractFromUrl('https://www.youtube.com/watch?v=abc'),
    ).toEqual({});
  });

  it('rejects malformed channel_id (wrong prefix)', () => {
    expect(
      extractFromUrl('https://www.youtube.com/channel/XCabc'),
    ).toEqual({});
  });

  it('handles relative URLs (resolved against youtube.com)', () => {
    expect(extractFromUrl('/channel/UCBJycsmduvYEL83R_U4JriQ', 'https://www.youtube.com'))
      .toEqual({ channel_id: 'UCBJycsmduvYEL83R_U4JriQ' });
  });

  it('handles m.youtube.com URLs', () => {
    expect(
      extractFromUrl('https://m.youtube.com/@MrBeast'),
    ).toEqual({ handle: '@MrBeast' });
  });
});
