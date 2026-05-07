import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import { _internal, registerHandlers } from '~/background/router';
import { listHistory } from '~/background/history';
import { hasSeen } from '~/background/dedup';
import { size } from '~/background/queue';
import type { CandidateMessage } from '~/shared/types';

const fetchMock = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-05-07T12:00:00Z'));
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response('{}', { status: 201 }));
  registerHandlers();
});

describe('end-to-end happy path', () => {
  it('candidate → POST → accepted → history + dedup', async () => {
    const msg: CandidateMessage = {
      type: 'youtube/channel-candidate',
      channel_id: 'UCBJycsmduvYEL83R_U4JriQ',
      sourceUrl: 'https://www.youtube.com/channel/UCBJycsmduvYEL83R_U4JriQ',
    };
    await _internal.handleCandidate(msg);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(await size()).toBe(0);
    expect(await hasSeen('UCBJycsmduvYEL83R_U4JriQ')).toBe(true);
    const hist = await listHistory();
    expect(hist[0]?.status).toBe('accepted');
    expect(hist[0]?.rawValue).toBe('UCBJycsmduvYEL83R_U4JriQ');
  });

  it('same channel from second candidate is deduped, no second POST', async () => {
    const msg: CandidateMessage = {
      type: 'youtube/channel-candidate',
      channel_id: 'UCBJycsmduvYEL83R_U4JriQ',
      sourceUrl: 'https://www.youtube.com/',
    };
    await _internal.handleCandidate(msg);
    await _internal.handleCandidate(msg);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('handle candidate strips @ before POSTing', async () => {
    const msg: CandidateMessage = {
      type: 'youtube/channel-candidate',
      handle: '@MrBeast',
      sourceUrl: 'https://www.youtube.com/@MrBeast',
    };
    await _internal.handleCandidate(msg);
    const [, init] = fetchMock.mock.calls[0]!;
    expect(JSON.parse((init as any).body)).toEqual({ content: 'MrBeast' });
  });

  it('rejects malformed channel_id', async () => {
    const msg: CandidateMessage = {
      type: 'youtube/channel-candidate',
      channel_id: 'XXbad',
      sourceUrl: 'https://www.youtube.com/',
    };
    await _internal.handleCandidate(msg);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
