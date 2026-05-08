# scrape-ext

Scrape.Exchange browser extension. Scans YouTube pages for channel
references and submits each unique channel to the Scrape.Exchange request
API. Chrome and Firefox, MV3.

## Develop

```
npm install
npm run dev          # Chrome dev build, opens browser with extension loaded
npm run dev:firefox  # Firefox dev build
```

## Build

```
npm run build           # → .output/chrome-mv3/
npm run build:firefox   # → .output/firefox-mv2/
```

Load the unpacked output directory via `chrome://extensions` (Developer mode → Load unpacked) or `about:debugging` (Firefox → This Firefox → Load Temporary Add-on).

## Test

```
npm test
```

## Manual smoke checklist (run in both browsers per release)

- `/@handle` channel page (e.g. https://www.youtube.com/@MrBeast)
- `/channel/UC…` channel page
- Watch page sidebar (paired identifiers)
- Search results page
- Home feed
- SPA navigation between two of the above (no full reload)
- Offline → online resumes drain
- Popup live-updates as submissions land
