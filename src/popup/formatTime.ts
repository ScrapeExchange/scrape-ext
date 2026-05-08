const AMS_FMT = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Europe/Amsterdam',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const UTC_FMT = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'UTC',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

export function formatAmsterdamWithUTC(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const d = new Date(t);
  const ams = AMS_FMT.format(d).replace(',', '');
  const utc = UTC_FMT.format(d);
  return `${ams} (${utc} UTC)`;
}
