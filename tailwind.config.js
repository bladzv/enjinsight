/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // ── Foundry design system ─────────────────────────────────────────
        // Warm-charcoal monochrome with a violet-purple accent matching the brand logo.

        // Surface stack — deep indigo-black with a faint purple-blue undertone
        ink:               '#08080f',
        surface:           '#0d0d16',
        card:              '#12121e',
        'surface-high':    '#181828',
        'surface-highest': '#1f1f30',
        'surface-bright':  '#27273a',
        rim:               '#27273a',
        border:            '#29293c',
        term:              '#04040b',

        // Brand accent — violet/purple (left side of logo gradient)
        primary:        '#7C3AED',
        'primary-dim':  '#6D28D9',
        'primary-glow': '#c4b5fd',
        'on-primary':   '#fafafa',

        // Signal accents
        // cyan = blue side of logo gradient (royal blue)
        cyan:           '#60a5fa',
        'cyan-dim':     '#3b82f6',
        success:        '#a3e635',
        'success-dim':  '#65a30d',
        warning:        '#facc15',
        'warning-dim':  '#eab308',
        danger:         '#f43f5e',
        'danger-dim':   '#e11d48',

        // Text hierarchy
        text:             '#fafafa',
        'text-secondary': '#a8a8c0',
        dim:              '#a8a8c0',
        muted:            '#52527a',
      },
      fontFamily: {
        sans:     ['"Inter"', 'ui-sans-serif', 'system-ui', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Helvetica', 'Arial', 'sans-serif'],
        headline: ['"Inter Tight"', '"Inter"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        brand:    ['"Inter Tight"', '"Inter"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono:     ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', '"Liberation Mono"', '"Courier New"', 'monospace'],
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'fade-in':    'fadeIn 0.25s ease-out',
        'slide-down': 'slideDown 0.25s ease-out',
        'blink':      'blink 1.2s step-end infinite',
        'tick':       'tick 1.2s steps(2, end) infinite',
      },
      keyframes: {
        fadeIn: {
          '0%':   { opacity: 0, transform: 'translateY(-4px)' },
          '100%': { opacity: 1, transform: 'translateY(0)' },
        },
        slideDown: {
          '0%':   { opacity: 0, maxHeight: '0px' },
          '100%': { opacity: 1, maxHeight: '2000px' },
        },
        blink: {
          '0%, 100%': { opacity: 1 },
          '50%':      { opacity: 0 },
        },
        tick: {
          '0%, 49%':   { opacity: 1 },
          '50%, 100%': { opacity: 0.35 },
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
