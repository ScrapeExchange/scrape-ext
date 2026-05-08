import { browser } from 'wxt/browser';
import { scanDocument } from '../src/content/scan';
import type { CandidateMessage } from '../src/shared/types';

const SCAN_THROTTLE_MS = 500;
const STUDIO_HOSTS = new Set(['studio.youtube.com']);

export default defineContentScript({
  matches: ['*://*.youtube.com/*'],
  main(_ctx) {
    if (STUDIO_HOSTS.has(location.hostname)) return;

    const emitted = new Set<string>();
    const processedAnchors = new WeakSet<HTMLAnchorElement>();
    let timer: number | null = null;

    function schedule(): void {
      if (timer !== null) return;
      timer = window.setTimeout(() => {
        timer = null;
        void scanDocument({
          currentUrl: location.href,
          sendMessage: async (msg: CandidateMessage) => {
            try {
              await browser.runtime.sendMessage(msg);
            } catch {
              /* background not yet warm; will be re-attempted on next scan */
            }
          },
          emitted,
          processedAnchors,
        });
      }, SCAN_THROTTLE_MS);
    }

    schedule();

    window.addEventListener('yt-navigate-finish', schedule);
    // Scroll is YouTube's infinite-scroll trigger; the throttled scan picks
    // up newly-loaded feed cards. A document.body subtree MutationObserver
    // would catch the same content but fires on every animation/thumbnail
    // mutation YouTube makes — far too expensive.
    window.addEventListener('scroll', schedule, { passive: true });

    const titleEl = document.querySelector('title');
    if (titleEl) {
      const obs = new MutationObserver(() => schedule());
      obs.observe(titleEl, { childList: true, characterData: true, subtree: true });
    }
  },
});
