/**
 * The frame every transactional email from a list sits in.
 *
 * Mail clients are not browsers: Gmail strips <style> blocks in some views,
 * Outlook lays out with Word, and neither runs script. So this is the shape
 * that holds up everywhere: nested tables, every style inline, a button built
 * from a padded table cell around a link, and system fonts. The colours are
 * CommsHQ's light theme (config/crosswind.ts), which reads well on the white
 * and near-white backgrounds clients force on email.
 *
 * The header names the list, not CommsHQ: the reader signed up to that list,
 * and a sender they recognise is what keeps a confirmation out of spam.
 */

export const EMAIL_COLORS = {
  paper: '#f7f1ea',
  panel: '#ffffff',
  ink: '#201d1a',
  muted: '#6f665e',
  line: '#e6ddd3',
  coral: '#bd3e2e',
  coralInk: '#ffffff',
} as const

const FONT = `-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif`

export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

export interface EmailButton {
  label: string
  url: string
}

export interface EmailFrame {
  /** Who the email is from, as the reader knows them: the list name. */
  brand: string
  /** Shown in the inbox list after the subject, and hidden in the body. */
  preheader: string
  heading: string
  /** Paragraphs, already escaped. */
  paragraphs: string[]
  button?: EmailButton
  /** Paragraphs under the card, already escaped. */
  footer: string[]
}

/** The first letter of the brand, for the coral tile in the header. */
export function brandInitial(brand: string): string {
  const letter = [...brand.trim()].find(char => /\p{L}|\p{N}/u.test(char))
  return (letter ?? 'C').toLocaleUpperCase()
}

function buttonHtml(button: EmailButton): string {
  const url = escapeHtml(button.url)
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 0">
<tr><td align="center" bgcolor="${EMAIL_COLORS.coral}" style="border-radius:999px;background:${EMAIL_COLORS.coral}">
<a href="${url}" target="_blank" style="display:inline-block;padding:14px 28px;font-family:${FONT};font-size:16px;font-weight:700;line-height:20px;color:${EMAIL_COLORS.coralInk};text-decoration:none;border-radius:999px">${escapeHtml(button.label)}</a>
</td></tr>
</table>
<p style="margin:24px 0 0;font-family:${FONT};font-size:13px;line-height:20px;color:${EMAIL_COLORS.muted}">If the button does not work, paste this link into your browser:<br><a href="${url}" target="_blank" style="color:${EMAIL_COLORS.coral};word-break:break-all">${url}</a></p>`
}

export function renderEmail(frame: EmailFrame): string {
  const brand = escapeHtml(frame.brand)
  const paragraphs = frame.paragraphs
    .map(text => `<p style="margin:16px 0 0;font-family:${FONT};font-size:16px;line-height:26px;color:${EMAIL_COLORS.ink}">${text}</p>`)
    .join('\n')
  const footer = frame.footer
    .map(text => `<p style="margin:0 0 8px;font-family:${FONT};font-size:13px;line-height:20px;color:${EMAIL_COLORS.muted}">${text}</p>`)
    .join('\n')

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(frame.heading)}</title>
</head>
<body style="margin:0;padding:0;background:${EMAIL_COLORS.paper}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escapeHtml(frame.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${EMAIL_COLORS.paper}" style="background:${EMAIL_COLORS.paper}">
<tr><td align="center" style="padding:40px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px">
<tr><td style="padding:0 4px 20px">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td width="36" height="36" align="center" valign="middle" bgcolor="${EMAIL_COLORS.coral}" style="width:36px;height:36px;border-radius:10px;background:${EMAIL_COLORS.coral};font-family:${FONT};font-size:18px;font-weight:700;line-height:36px;color:${EMAIL_COLORS.coralInk}">${escapeHtml(brandInitial(frame.brand))}</td>
<td style="padding-left:12px;font-family:${FONT};font-size:16px;font-weight:700;color:${EMAIL_COLORS.ink}">${brand}</td>
</tr></table>
</td></tr>
<tr><td bgcolor="${EMAIL_COLORS.panel}" style="background:${EMAIL_COLORS.panel};border:1px solid ${EMAIL_COLORS.line};border-radius:20px;padding:36px 32px">
<h1 style="margin:0;font-family:${FONT};font-size:26px;font-weight:700;line-height:32px;color:${EMAIL_COLORS.ink}">${escapeHtml(frame.heading)}</h1>
${paragraphs}
${frame.button ? buttonHtml(frame.button) : ''}
</td></tr>
<tr><td style="padding:24px 4px 0">
${footer}
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`
}
