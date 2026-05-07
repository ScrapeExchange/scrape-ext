import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Scrape.Exchange — YouTube channel scraper',
    description:
      'Scans YouTube pages for channel references and submits each '
      + 'unique channel to the Scrape.Exchange request API.',
    version: '0.1.0',
    permissions: ['storage', 'alarms'],
    host_permissions: [
      '*://*.youtube.com/*',
      'https://scrape.exchange/*',
    ],
  },
});
