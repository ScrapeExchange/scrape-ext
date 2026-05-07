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
        });
      }, SCAN_THROTTLE_MS);
    }

    schedule();

    window.addEventListener('yt-navigate-finish', schedule);

    const titleEl = document.querySelector('title');
    if (titleEl) {
      const obs = new MutationObserver(() => schedule());
      obs.observe(titleEl, { childList: true, characterData: true, subtree: true });
    }
  },
});
