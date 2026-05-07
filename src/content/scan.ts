import { extractFromUrl } from './extract';
import { pairAnchor } from './pair';
import type { CandidateMessage } from '../shared/types';

export interface ScanContext {
  currentUrl: string;
  sendMessage: (msg: CandidateMessage) => Promise<void>;
  emitted?: Set<string>;
}

export async function scanDocument(ctx: ScanContext): Promise<void> {
  const seen = ctx.emitted ?? new Set<string>();
  if (!ctx.emitted) ctx.emitted = seen;

  const fromCurrent = extractFromUrl(ctx.currentUrl);
  if (fromCurrent.channel_id || fromCurrent.handle) {
    await emit(ctx, seen, fromCurrent.channel_id, fromCurrent.handle);
  }

  const canonical = document.querySelector<HTMLLinkElement>(
    'link[rel="canonical"]',
  );
  if (canonical?.href) {
    const r = extractFromUrl(canonical.href);
    if (r.channel_id || r.handle) {
      await emit(ctx, seen, r.channel_id, r.handle);
    }
  }

  const og = document.querySelector<HTMLMetaElement>(
    'meta[property="og:url"]',
  );
  if (og?.content) {
    const r = extractFromUrl(og.content);
    if (r.channel_id || r.handle) {
      await emit(ctx, seen, r.channel_id, r.handle);
    }
  }

  const anchors = document.querySelectorAll<HTMLAnchorElement>(
    'a[href*="/channel/"], a[href*="/@"]',
  );
  for (const a of anchors) {
    const paired = pairAnchor(a);
    if (paired.channel_id || paired.handle) {
      await emit(ctx, seen, paired.channel_id, paired.handle);
    }
  }
}

async function emit(
  ctx: ScanContext,
  seen: Set<string>,
  channel_id?: string,
  handle?: string,
): Promise<void> {
  const key = channel_id ? `c:${channel_id}` : handle ? `h:${handle}` : '';
  if (!key) return;
  if (seen.has(key)) return;
  seen.add(key);
  await ctx.sendMessage({
    type: 'youtube/channel-candidate',
    ...(channel_id ? { channel_id } : {}),
    ...(handle ? { handle } : {}),
    sourceUrl: ctx.currentUrl,
  });
}
