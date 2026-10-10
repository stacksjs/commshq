import type { CrosswindConfig, Theme } from '@cwcss/crosswind'

/**
 * Component roles use the existing editorial palette on marketing/auth pages.
 * component-tokens.css supplies dashboard defaults where no palette is declared.
 * Use theme entries rather than layered preflight overrides of library tokens.
 */
export default {
  shortcuts: {
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
