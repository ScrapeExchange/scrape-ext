// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { pairAnchor } from '~/content/pair';

function makeDom(html: string): Document {
  const doc = new DOMParser().parseFromString(
    `<html><body>${html}</body></html>`,
    'text/html',
  );
  return doc;
}

describe('pairAnchor', () => {
  it('prefers channel_id when sibling anchor in same card has UC link', () => {
    const doc = makeDom(`
      <ytd-channel-renderer>
        <a href="/@MrBeast" class="handle"></a>
        <a href="/channel/UCBJycsmduvYEL83R_U4JriQ" class="cid"></a>
      </ytd-channel-renderer>
    `);
    const handleAnchor = doc.querySelector('a.handle') as HTMLAnchorElement;
    expect(pairAnchor(handleAnchor)).toEqual({
      channel_id: 'UCBJycsmduvYEL83R_U4JriQ',
    });
  });

  it('returns own handle when no sibling channel_id is found', () => {
    const doc = makeDom(`
      <div>
        <a href="/@MrBeast" class="handle"></a>
      </div>
    `);
    const handleAnchor = doc.querySelector('a.handle') as HTMLAnchorElement;
    expect(pairAnchor(handleAnchor)).toEqual({ handle: '@MrBeast' });
  });

  it('returns own channel_id verbatim', () => {
    const doc = makeDom(`
      <ytd-video-renderer>
        <a href="/channel/UCBJycsmduvYEL83R_U4JriQ" class="cid"></a>
      </ytd-video-renderer>
    `);
    const cidAnchor = doc.querySelector('a.cid') as HTMLAnchorElement;
    expect(pairAnchor(cidAnchor)).toEqual({
      channel_id: 'UCBJycsmduvYEL83R_U4JriQ',
    });
  });

  it('walks up to ytd-compact-video-renderer ancestor', () => {
    const doc = makeDom(`
      <ytd-compact-video-renderer>
        <div>
          <a href="/@MrBeast" class="handle"></a>
        </div>
        <div>
          <a href="/channel/UCBJycsmduvYEL83R_U4JriQ" class="cid"></a>
        </div>
      </ytd-compact-video-renderer>
    `);
    const handleAnchor = doc.querySelector('a.handle') as HTMLAnchorElement;
    expect(pairAnchor(handleAnchor)).toEqual({
      channel_id: 'UCBJycsmduvYEL83R_U4JriQ',
    });
  });

  it('returns nothing for an unrelated anchor', () => {
    const doc = makeDom(`<a href="/watch?v=abc"></a>`);
    const a = doc.querySelector('a') as HTMLAnchorElement;
    expect(pairAnchor(a)).toEqual({});
  });
});
