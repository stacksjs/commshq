import type { CrosswindConfig, Theme } from '@cwcss/crosswind'

/*
 * The editorial palette, and the document defaults that go with it.
 *
 * This was three byte-identical <style> blocks -- resources/views/index.stx,
 * layouts/auth.stx and layouts/marketing.stx -- which is stx-standards rule 3
 * (never write vanilla CSS). The concrete harm was rule 11.1's second
 * mechanism: all three sat inside <head>, and the SPA router never removes the
 * entry page's server-rendered styles, so entering on one marketing page and
 * navigating to another left two :root blocks live at once.
 *
 * It belongs HERE specifically because the `colors` block below already maps
 * ninety-odd component roles onto these seven variables -- `bg-panel` is
 * var(--panel), `text-fg` is var(--ink), `text-accent` is var(--coral). Every
 * one of those utilities resolved to nothing on any page that did not carry one
 * of the three blocks, which is exactly the lie rule 11.2 is about.
 *
 * Two differences were unioned rather than preserved, because the blocks
 * disagreed and a single copy has to pick: `scroll-behavior: smooth` was on
 * index and marketing but not auth, and the serif stack covered h1-h3 on those
 * two but only h1 on auth. Both now apply everywhere. The auth layout has no
 * h2 or h3, so the second is invisible there.
 *
 * A preflight lands in @layer cw-base and therefore LOSES to an unlayered
 * utility of equal specificity. Tokens, element selectors and keyframes are
 * unaffected -- nothing competes with them -- which is why `.field` is a
 * shortcut below rather than another line in here.
 */
const LIGHT = `--paper:#f7f1ea;--ink:#201d1a;--muted:#6f665e;--coral:#bd3e2e;`
  + `--coral-ink:#ffffff;--line:#d9cec3;--panel:#fffaf5;color-scheme:light;`
const DARK = `--paper:#191715;--ink:#f8f0e8;--muted:#b9aca1;--coral:#ff8a78;`
  + `--coral-ink:#191715;--line:#403a35;--panel:#24211e;color-scheme:dark;`

/*
 * ## Why these stacks survive, which is not the reason this comment used to give
 *
 * It said the single quotes were load-bearing -- that a double-quoted family
 * name made the engine replace the stack with its own default and swallow the
 * rules after it. Both halves are wrong, and the measurement that disproves
 * them is three lines against the installed @stacksjs/ts-css:
 *
 *   body { font-family: ui-sans-serif, -apple-system, 'Segoe UI', sans-serif; }
 *     -> font-family: ui-sans-serif, system-ui, sans-serif
 *   body { font-family: ui-sans-serif, -apple-system, "Segoe UI", sans-serif; }
 *     -> the same substitution
 *   body{font-family:ui-sans-serif, -apple-system, 'Segoe UI', sans-serif}
 *     -> unchanged
 *
 * The trigger is the SPACED rule form -- `sel { prop: value; }` -- with a stack
 * that begins with `ui-sans-serif`. Quoting is irrelevant, and nothing is
 * swallowed: a rule written after the substituted one survives intact.
 *
 * What protects this file is that every PREFLIGHT_RULES entry below is written
 * TIGHT, `body{margin:0;...}`, which the engine passes through as text. The
 * quoting is a style choice and the two forms mean the same thing in CSS, so
 * keeping single quotes costs nothing -- but it is not what makes this work,
 * and writing one of these rules spaced would silently repaint the body.
 *
 * A stack that does not start with `ui-sans-serif` is never touched, which is
 * why SERIF below would be safe either way. Anything behind `var()` or
 * declared as a custom property is never touched either, and that is the only
 * form that does not depend on remembering any of this -- see bughq's
 * `--sans-system`.
 */
const SANS = 'ui-sans-serif, -apple-system, BlinkMacSystemFont, \'Segoe UI\', sans-serif'
const SERIF = '\'Iowan Old Style\', \'Palatino Linotype\', Palatino, Georgia, serif'

/*
 * One entry per rule, kept for readability rather than necessity.
 *
 * An earlier version of this comment said the split was load-bearing, on the
 * strength of a measurement taken against @cwcss/crosswind -- which this file
 * imports its TYPES from and which does not render the app. stx loads
 * @stacksjs/ts-css on every path, and that engine keeps every rule in a
 * multi-rule getCSS().
 *
 * The corruption that prompted the split was real, and the cause was the
 * QUOTING below rather than the structure. See the note on SANS and SERIF.
 */
const PREFLIGHT_RULES: string[] = [
  `:root{${LIGHT}}`,
  `:root.dark{${DARK}}`,
  `html{background:var(--paper);scroll-behavior:smooth}`,
  `body{margin:0;background:var(--paper);color:var(--ink);font-family:${SANS}}`,
  `h1,h2,h3{font-family:${SERIF}}`,
  `@keyframes reveal{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:translateY(0)}}`,
  `@media (prefers-reduced-motion: reduce){html{scroll-behavior:auto}}`,

  /*
   * MarketingNavigation's three structural selectors. None can be a utility on
   * the element it styles: the chevron is rotated by an ancestor's [open]
   * state, and the scroll lock is on <body> while the trigger is in the
   * component.
   *
   * The marker reset looks like it could be an arbitrary-variant utility,
   * [&::-webkit-details-marker]:hidden, and cannot: this engine's extractor
   * rejects any class whose variant is an arbitrary selector, so the class
   * never reaches the generator and emits nothing at all. [&>p]:underline is
   * dropped the same way. Same extractor defect as stacksjs/ts-css#37, which
   * ts-css 0.3.16 fixes and @cwcss/crosswind does not. Tried, measured,
   * reverted -- revisit when this app moves engines.
   */
  `.feature-summary::-webkit-details-marker{display:none}`,
  `.feature-menu[open] > .feature-summary .feature-chevron{transform:rotate(180deg)}`,
  `@media (max-width: 767px){body:has(.mobile-menu[open]){overflow:hidden}}`,
]

/**
 * Component roles use the existing editorial palette on marketing/auth pages.
 * component-tokens.css supplies dashboard defaults where no palette is declared.
 * Use theme entries rather than layered preflight overrides of library tokens.
 */
export default {
  preflights: PREFLIGHT_RULES.map(css => ({ getCSS: () => css })),
  shortcuts: {
    /*
     * Seven hand-written utility shims, lifted out of the same three <style>
     * blocks. Each expands to the native utility this config's own colour
     * roles already provide, with byte-identical output -- verified by
     * generating both -- so roughly 390 call sites keep working while the
     * vanilla CSS goes away.
     *
     * They are deliberately transitional. The markup should read `bg-panel`
     * and `text-fg`, and these should then be deleted; doing that rename in
     * the same change as the de-vanilling would have put a 390-token
     * search-and-replace in a commit that also moves the tokens. Note
     * `.text-balance` is NOT here: `text-wrap: balance` is a built-in
     * utility, so that shim was dead weight shadowing a real class.
     */
    'paper': 'bg-page',
    'panel': 'bg-panel',
    'ink': 'text-fg',
    'muted': 'text-fg-muted',
    'coral': 'text-accent',
    'bg-coral': 'bg-accent',
    'border-tone': 'border-line',

    // index.stx's two editorial treatments. `reveal`'s reduced-motion guard is
    // `motion-reduce:animate-none` and NOT `motion-reduce:[animation:none]`:
    // this engine drops a variant on an arbitrary property entirely
    // (stacksjs/ts-css#37, fixed in ts-css 0.3.16, not in @cwcss/crosswind),
    // so the idiomatic spelling is also the only one that emits.
    'editorial-grid': '[background-image:linear-gradient(to_right,color-mix(in_srgb,var(--line)_45%,transparent)_1px,transparent_1px)] '
      + '[background-size:min(8vw,6rem)_100%]',
    'reveal': '[animation:reveal_700ms_both] [animation-timeline:view()] '
      + '[animation-range:entry_8%_cover_28%] motion-reduce:animate-none',

    /*
     * auth.stx's text input. A shortcut rather than a preflight line because
     * `.field:focus` in @layer cw-base loses to an unlayered `.field`, which is
     * a mistake bughq already made and recorded.
     *
     * The font shorthand is decomposed rather than carried as
     * `[font:400_16px/1.4_...]`. That spelling WORKS on the engine that renders
     * this app -- ts-css fixed arbitrary properties named after a utility
     * family in 0.3.14, and 0.3.15 is installed -- so this is a readability
     * choice, not a workaround; an earlier note here claimed otherwise after
     * measuring @cwcss/crosswind, which only supplies this file's types. The
     * decomposed form emits the same four declarations, and the focus ring is
     * four utilities for the same reason.
     */
    'field': 'w-full box-border py-[0.65rem] px-[0.8rem] border border-solid border-line '
      + 'rounded-control bg-page text-fg font-normal text-[16px]/[1.4] '
      + '[font-family:ui-sans-serif,-apple-system,sans-serif] '
      + 'focus:outline-2 focus:outline-solid focus:outline-accent focus:outline-offset-1',

    // Preserve the existing consent pill while Badge owns its markup. Explicit
    // precedence is required: class attribute order does not decide CSS order.
    'audience-consent-badge': 'sm:!inline !px-2.5 !py-1 !font-bold !text-[#466833] !bg-[#edf5e8] '
      + 'dark:!text-[#acd294] dark:!bg-[#75a65a]/15',
    // These were flex items. Block-level flex avoids an extra inline baseline
    // inside the component scope wrapper, preserving the original row heights.
    'workspace-change-badge': '!flex !px-2.5 !py-1 !font-bold !text-[11px] !leading-[inherit] '
      + '!text-[#42652e] !bg-[#eef5e8] dark:!text-[#a8d28e] dark:!bg-[#75a65a]/15',
    'workspace-record-badge': '!flex !py-1 !font-bold !text-[10px] !leading-[inherit] '
      + '!text-[#466833] !bg-[#eef5e8] dark:!text-[#acd294] dark:!bg-[#75a65a]/15',
    // The readiness panel is dark in both modes, so this treatment stays fixed.
    'workspace-check-badge': '!flex !py-1 !font-bold !text-[10px] !leading-[inherit] !text-[#bfe2ab] !bg-white/10',
  },
  theme: {
    extend: {
      borderRadius: {
        control: '10px',
        panel: '12px',
        pill: '999px',
      },
      colors: {
        'panel': 'var(--panel)',
        'line': 'var(--line)',
        'accent': 'var(--coral)',
        'accent-ink': 'var(--coral-ink)',
        'accent-soft': 'color-mix(in srgb, var(--coral) 8%, var(--panel))',
        'surface': 'var(--panel)',
        'surface-sunken': 'var(--paper)',
        'surface-raised': 'color-mix(in srgb, var(--coral) 8%, var(--panel))',
        'surface-hover': 'color-mix(in srgb, var(--ink) 6%, var(--panel))',
        'surface-raised-hover': 'color-mix(in srgb, var(--coral) 14%, var(--panel))',
        'surface-sunken-hover': 'color-mix(in srgb, var(--ink) 6%, var(--paper))',
        'page': 'var(--paper)',
        'content': 'var(--panel)',
        'field': 'var(--panel)',
        'field-hover': 'color-mix(in srgb, var(--ink) 6%, var(--panel))',
        'fg': 'var(--ink)',
        'fg-strong': 'var(--ink)',
        /*
         * The library asks for four steps of quiet text - fg, fg-muted,
         * fg-soft, fg-subtle - and this palette has TWO: --ink and --muted. So the
         * three quiet roles all take the same value, and that is a statement
         * rather than an oversight.
         *
         * The other four HQ apps have a third text step and point fg-soft at
         * it, because <Breadcrumb> paints separators with fg-soft and links
         * with fg-muted, and equal values make a divider as loud as the labels
         * it divides. There is nothing to point at here. Inventing a third
         * grey with color-mix would be a design decision, not a mapping, so it
         * stays a deliberate collapse until this palette grows one.
         */
        'fg-muted': 'var(--muted)',
        'fg-soft': 'var(--muted)',
        'fg-subtle': 'var(--muted)',
        'line-strong': 'color-mix(in srgb, var(--muted) 55%, var(--line))',
        'line-hover': 'color-mix(in srgb, var(--muted) 70%, var(--line))',
        'link': 'var(--coral)',
        'link-hover': 'color-mix(in srgb, var(--coral) 85%, var(--ink))',
        'accent-solid': 'var(--coral)',
        'accent-solid-hover': 'color-mix(in srgb, var(--coral) 92%, var(--ink))',
        'accent-soft-ink': 'color-mix(in srgb, var(--coral) 85%, var(--ink))',
        'success': 'var(--comms-success)',
        'success-solid': 'var(--comms-success)',
        'success-solid-hover': 'color-mix(in srgb, var(--comms-success) 92%, var(--ink))',
        'success-ink': 'var(--coral-ink)',
        'success-soft': 'color-mix(in srgb, var(--comms-success) 8%, var(--panel))',
        'success-soft-ink': 'color-mix(in srgb, var(--comms-success) 85%, var(--ink))',
        'danger': 'var(--comms-danger)',
        'danger-solid': 'var(--comms-danger)',
        'danger-solid-hover': 'color-mix(in srgb, var(--comms-danger) 92%, var(--ink))',
        'danger-ink': 'var(--coral-ink)',
        'danger-soft': 'color-mix(in srgb, var(--comms-danger) 8%, var(--panel))',
        'danger-soft-ink': 'color-mix(in srgb, var(--comms-danger) 85%, var(--ink))',
        'warning': 'var(--muted)',
        'warning-solid': 'var(--muted)',
        'warning-solid-hover': 'color-mix(in srgb, var(--muted) 92%, var(--ink))',
        'warning-ink': 'var(--coral-ink)',
        'warning-soft': 'color-mix(in srgb, var(--muted) 8%, var(--panel))',
        'warning-soft-ink': 'color-mix(in srgb, var(--muted) 85%, var(--ink))',
        'info': 'var(--muted)',
        'info-solid': 'var(--muted)',
        'info-solid-hover': 'color-mix(in srgb, var(--muted) 92%, var(--ink))',
        'info-ink': 'var(--coral-ink)',
        'info-soft': 'color-mix(in srgb, var(--muted) 8%, var(--panel))',
        'info-soft-ink': 'color-mix(in srgb, var(--muted) 85%, var(--ink))',
        'secondary': 'var(--muted)',
        'secondary-solid': 'var(--muted)',
        'secondary-solid-hover': 'color-mix(in srgb, var(--muted) 92%, var(--ink))',
        'secondary-ink': 'var(--coral-ink)',
        'secondary-soft': 'color-mix(in srgb, var(--muted) 8%, var(--panel))',
        'secondary-soft-ink': 'color-mix(in srgb, var(--muted) 85%, var(--ink))',
        'danger-fg': 'var(--comms-danger)',
        'danger-fg-subtle': 'var(--comms-danger)',
        'danger-line': 'var(--comms-danger)',
        'danger-focus': 'var(--comms-danger)',
        'inverse': 'var(--ink)',
        'inverse-ink': 'var(--paper)',
      },
    },
  },
} satisfies Partial<Omit<CrosswindConfig, 'theme'>> & { theme?: Pick<Theme, 'extend'> }
