import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { STORAGE_KEYS } from '../../src/shared/constants';
import { listHistory } from '../../src/background/history';
import { formatAmsterdamWithUTC } from '../../src/popup/formatTime';
import type { HistoryEntry } from '../../src/shared/types';

export function App() {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);

  useEffect(() => {
    void listHistory().then(setEntries);
    const onChange = (
      changes: Record<string, { oldValue?: unknown; newValue?: unknown }>,
      area: string,
    ) => {
      if (area !== 'local') return;
      if (changes[STORAGE_KEYS.history]) {
        const next = changes[STORAGE_KEYS.history]!.newValue as HistoryEntry[] | undefined;
        setEntries(next ?? []);
      }
    };
    browser.storage.onChanged.addListener(onChange);
    return () => {
      browser.storage.onChanged.removeListener(onChange);
    };
  }, []);

  return (
    <>
      <header>
        Scrape.Exchange — last <span className="count">{entries.length}</span> submissions
      </header>
      {entries.length === 0 ? (
        <div className="empty">Nothing submitted yet. Visit any YouTube page.</div>
      ) : (
        <ul>
          {entries.map((e) => (
            <li key={e.id}>
              <span>
                <span className="id">{e.rawValue}</span>{' '}
                <span className={`chip chip-${e.status}`}>{e.status}</span>
              </span>
              <span className="ts">{formatAmsterdamWithUTC(e.enqueuedAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
