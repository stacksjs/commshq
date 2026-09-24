/**
 * Every campaign email carries a way out: a link in the body and the
 * List-Unsubscribe headers (RFC 8058) that put an Unsubscribe button in the
 * mail client itself. Gmail and Yahoo require the headers from bulk senders,
 * and a list without them gets marked as spam instead of left.
 *
 * `{{unsubscribe_url}}` in the template places the link; otherwise a footer
 * is added.
 */
export function withUnsubscribe(html: string, text: string, unsubscribeUrl: string): { html: string, text: string, headers: Record<string, string> } {
  // A fresh pattern per use: a shared /g regex carries lastIndex between calls.
  const placeholder = () => /\{\{\s*unsubscribe_url\s*\}\}/g
  const safeUrl = unsubscribeUrl.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
  return {
    html: placeholder().test(html)
      ? html.replace(placeholder(), safeUrl)
      : `${html}<p style="font-size:12px;color:#777;margin-top:32px">Not for you any more? <a href="${safeUrl}">Unsubscribe</a>.</p>`,
    text: placeholder().test(text) ? text.replace(placeholder(), unsubscribeUrl) : `${text}\n\n--\nUnsubscribe: ${unsubscribeUrl}`,
    headers: {
      'List-Unsubscribe': `<${unsubscribeUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  }
}
