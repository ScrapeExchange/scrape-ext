const CHANNEL_ID_PATH_RE = /^\/channel\/(UC[A-Za-z0-9_-]{22})(?:\/|$)/;
const HANDLE_PATH_RE = /^\/(@[A-Za-z0-9._-]{1,30})(?:\/|$)/;

export interface ExtractResult {
  channel_id?: string;
  handle?: string;
}

export function extractFromUrl(
  href: string,
  base?: string,
): ExtractResult {
  let url: URL;
  try {
    url = new URL(href, base ?? 'https://www.youtube.com');
  } catch {
    return {};
  }

  const channelMatch = url.pathname.match(CHANNEL_ID_PATH_RE);
  if (channelMatch) return { channel_id: channelMatch[1] };

  const handleMatch = url.pathname.match(HANDLE_PATH_RE);
  if (handleMatch) return { handle: handleMatch[1] };

  return {};
}
