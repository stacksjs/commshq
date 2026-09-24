/**
 * Responses for the public endpoints, which answer other people's sites and
 * people clicking links in email rather than CommsHQ's own pages.
 *
 * Built as plain `Response`s so a CORS header set here is the one the browser
 * sees, and so a page needs nothing from the views server: the links in an
 * email reach the API process directly (see config/server.ts `proxy`).
 */

export function jsonResponse(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  })
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * A small, self-contained page: a heading, a line of text, and optionally a
 * form with one button. `body` is trusted markup; callers escape anything
 * they interpolate into it.
 */
export function pageResponse(title: string, body: string, status = 200): Response {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light dark; --bg: #fafafa; --text: #111; --muted: #555; --line: #e4e4e4; }
  @media (prefers-color-scheme: dark) { :root { --bg: #0a0a0a; --text: #ededed; --muted: #a8a8a8; --line: #242424; } }
  body { margin: 0; background: var(--bg); color: var(--text); font: 16px/1.6 ui-sans-serif, system-ui, -apple-system, sans-serif; }
  main { max-width: 32rem; margin: 18vh auto 0; padding: 0 1.25rem; }
  h1 { font-size: 1.5rem; line-height: 1.25; margin: 0 0 0.75rem; }
  p { color: var(--muted); margin: 0 0 1.25rem; }
  button { font: inherit; padding: 0.6rem 1.1rem; border: 1px solid var(--text); background: var(--text); color: var(--bg); border-radius: 6px; cursor: pointer; }
  a { color: inherit; }
</style>
</head>
<body><main><h1>${escapeHtml(title)}</h1>${body}</main></body>
</html>`
  return new Response(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}
