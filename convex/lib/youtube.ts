/** Parses a pasted YouTube URL into its 11-char video ID. Supports
 * watch?v=, youtu.be/, and /embed/ URL shapes. Returns null (never
 * throws) for anything else - callers decide how to surface that. */
export function parseYoutubeVideoId(input: string): string | null {
  const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\.|^m\./, "").toLowerCase();

  if (host === "youtu.be") {
    const id = url.pathname.slice(1).split("/")[0];
    return VIDEO_ID_RE.test(id) ? id : null;
  }
  if (host === "youtube.com" || host === "youtube-nocookie.com") {
    if (url.pathname === "/watch") {
      const id = url.searchParams.get("v");
      return id && VIDEO_ID_RE.test(id) ? id : null;
    }
    const embedMatch = url.pathname.match(/^\/embed\/([^/]+)/);
    if (embedMatch) return VIDEO_ID_RE.test(embedMatch[1]) ? embedMatch[1] : null;
  }
  return null;
}
