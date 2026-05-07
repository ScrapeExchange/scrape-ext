import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import { scanDocument } from '~/content/scan';
import type { CandidateMessage } from '~/shared/types';

beforeEach(() => {
  fakeBrowser.reset();
  document.body.innerHTML = '';
});

describe('scanDocument', () => {
  it('emits candidate from current page URL', async () => {
    const sent: unknown[] = [];
    const sendMessage = vi.fn(async (msg) => {
      sent.push(msg);
    });
    await scanDocument({
      currentUrl: 'https://www.youtube.com/channel/UCBJycsmduvYEL83R_U4JriQ',
      sendMessage,
    });
    expect(sent).toContainEqual({
      type: 'youtube/channel-candidate',
      channel_id: 'UCBJycsmduvYEL83R_U4JriQ',
      sourceUrl: 'https://www.youtube.com/channel/UCBJycsmduvYEL83R_U4JriQ',
    } satisfies CandidateMessage);
  });

  it('emits candidate from anchor href', async () => {
    document.body.innerHTML = `
      <a href="/channel/UCBJycsmduvYEL83R_U4JriQ">link</a>
    `;
    const sent: CandidateMessage[] = [];
    await scanDocument({
      currentUrl: 'https://www.youtube.com/',
      sendMessage: async (m) => { sent.push(m as CandidateMessage); },
    });
    expect(sent.some((m) => m.channel_id === 'UCBJycsmduvYEL83R_U4JriQ')).toBe(true);
  });

  it('prefers paired channel_id over handle in same card', async () => {
    document.body.innerHTML = `
      <ytd-channel-renderer>
        <a href="/@MrBeast" class="h"></a>
        <a href="/channel/UCBJycsmduvYEL83R_U4JriQ" class="c"></a>
      </ytd-channel-renderer>
    `;
    const sent: CandidateMessage[] = [];
    await scanDocument({
      currentUrl: 'https://www.youtube.com/',
      sendMessage: async (m) => { sent.push(m as CandidateMessage); },
    });
    expect(sent.some((m) => m.handle === '@MrBeast')).toBe(false);
    expect(sent.some((m) => m.channel_id === 'UCBJycsmduvYEL83R_U4JriQ')).toBe(true);
  });

  it('emits same anchor only once across two scans (in-tab dedup)', async () => {
    document.body.innerHTML = `
      <a href="/channel/UCBJycsmduvYEL83R_U4JriQ">link</a>
    `;
    const sent: CandidateMessage[] = [];
    const ctx = {
      currentUrl: 'https://www.youtube.com/',
      sendMessage: async (m: CandidateMessage) => { sent.push(m); },
    };
    await scanDocument(ctx);
    await scanDocument(ctx);
    const cidMessages = sent.filter((m) => m.channel_id === 'UCBJycsmduvYEL83R_U4JriQ');
    expect(cidMessages).toHaveLength(1);
  });
});
