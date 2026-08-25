/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // ── Foundry design system ─────────────────────────────────────────
        // Warm-charcoal monochrome with a violet-purple accent matching the brand logo.

        // Surface stack — deep indigo-black with a faint purple-blue undertone
        ink:               'rgb(var(--ink-rgb) / <alpha-value>)',
        surface:           'rgb(var(--surface-rgb) / <alpha-value>)',
        card:              'rgb(var(--card-rgb) / <alpha-value>)',
        'surface-high':    'rgb(var(--surface-high-rgb) / <alpha-value>)',
        'surface-highest': 'rgb(var(--surface-highest-rgb) / <alpha-value>)',
        'surface-bright':  'rgb(var(--surface-bright-rgb) / <alpha-value>)',
        rim:               'rgb(var(--rim-rgb) / <alpha-value>)',
        border:            'rgb(var(--border-rgb) / <alpha-value>)',
        term:              'rgb(var(--term-rgb) / <alpha-value>)',

        // Brand accent — violet/purple (left side of logo gradient)
        primary:        'rgb(var(--primary-rgb) / <alpha-value>)',
        'primary-dim':  'rgb(var(--primary-dim-rgb) / <alpha-value>)',
        'primary-glow': 'rgb(var(--primary-glow-rgb) / <alpha-value>)',
        'on-primary':   'rgb(var(--on-primary-rgb) / <alpha-value>)',

        // Signal accents
        // cyan = blue side of logo gradient (royal blue)
        cyan:           'rgb(var(--cyan-rgb) / <alpha-value>)',
        'cyan-dim':     'rgb(var(--cyan-dim-rgb) / <alpha-value>)',
        success:        'rgb(var(--success-rgb) / <alpha-value>)',
        'success-dim':  'rgb(var(--success-dim-rgb) / <alpha-value>)',
        warning:        'rgb(var(--warning-rgb) / <alpha-value>)',
        'warning-dim':  'rgb(var(--warning-dim-rgb) / <alpha-value>)',
        danger:         'rgb(var(--danger-rgb) / <alpha-value>)',
        'danger-dim':   'rgb(var(--danger-dim-rgb) / <alpha-value>)',

        // Text hierarchy
        text:             'rgb(var(--text-rgb) / <alpha-value>)',
        'text-secondary': 'rgb(var(--text-secondary-rgb) / <alpha-value>)',
        dim:              'rgb(var(--dim-rgb) / <alpha-value>)',
        muted:            'rgb(var(--muted-rgb) / <alpha-value>)',
      },
      fontFamily: {
        sans:     ['"Inter"', 'ui-sans-serif', 'system-ui', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Helvetica', 'Arial', 'sans-serif'],
        headline: ['"Inter Tight"', '"Inter"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        brand:    ['"Inter Tight"', '"Inter"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono:     ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', '"Liberation Mono"', '"Courier New"', 'monospace'],
      },
      animation: {
        'pulse-slow':   'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'fade-in':      'fadeIn 0.25s ease-out',
        'blink':        'blink 1.2s step-end infinite',
        'tick':         'tick 1.2s steps(2, end) infinite',
        'scroll-nudge': 'scrollNudge 1.5s ease-in-out infinite',
      },
      keyframes: {
        fadeIn: {
          '0%':   { opacity: 0, transform: 'translateY(-4px)' },
          '100%': { opacity: 1, transform: 'translateY(0)' },
        },
        blink: {
          '0%, 100%': { opacity: 1 },
          '50%':      { opacity: 0 },
        },
        tick: {
          '0%, 49%':   { opacity: 1 },
          '50%, 100%': { opacity: 0.35 },
        },
        scrollNudge: {
          '0%, 100%': { transform: 'translateY(0)',   opacity: '0.45' },
          '55%':      { transform: 'translateY(5px)', opacity: '1'    },
        },
      },
      boxShadow: {
        'primary-glow': '0 0 20px rgba(124, 58, 237, 0.25)',
        'cyan-glow':    '0 0 18px rgba(96, 165, 250, 0.20)',
        'card':         '0 1px 0 rgba(255,255,255,0.02) inset',
        'float':        '0 8px 24px rgba(0,0,0,0.45)',
        'ambient':      '0 1px 0 rgba(255,255,255,0.02) inset',
        'inset-soft':   'inset 0 1px 0 rgba(255,255,255,0.03)',
      },
      borderRadius: {
        DEFAULT: '0.25rem',
        sm:      '0.125rem',
        lg:      '0.25rem',
        xl:      '0.375rem',
      },
      letterSpacing: {
        tightest: '-0.04em',
      },
    },
  },
  plugins: [],
}
