/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // ── Kinetic Ledger design system ────────────────────────────────
        // Surface hierarchy (layered depth, no-line rule)
        ink:     '#0c0e17',           // base layer (background)
        surface: '#11131d',           // section layer
        card:    '#171924',           // component layer (surface-container)
        border:  '#464752',           // ghost borders at 15% opacity
        rim:     '#282b3a',           // surface-bright / interaction layer

        // Primary palette
        primary:       '#b6a0ff',
        'primary-dim': '#8051ff',
        'primary-glow':'#aa8fff',     // primary-fixed

        // Signal accents
        cyan:      '#00eefc',         // secondary / data viz
        'cyan-dim':'#00deec',
        success:   '#8eff71',         // tertiary
        'success-dim': '#2be800',
        warning:   '#F59E0B',
        danger:    '#ff6e84',         // error
        'danger-dim': '#d73357',

        // Text hierarchy
        text:             '#f0f0fd',  // on-surface — primary text
        'text-secondary': '#aaaab7',  // on-surface-variant
        dim:              '#aaaab7',  // secondary text
        muted:            '#737580',  // outline

        // Semantic surface tokens
        'surface-high':    '#1c1f2b', // surface-container-high
        'surface-highest': '#222532', // surface-container-highest
        'surface-bright':  '#282b3a', // hover / interaction
        term:              '#000000', // terminal background (surface-container-lowest)

        // Legacy compatibility aliases
        'on-primary': '#350090',
      },
      fontFamily: {
        sans:     ['Inter', 'system-ui', 'sans-serif'],
        headline: ['"Space Grotesk"', 'system-ui', 'sans-serif'],
        brand:   ['Poppins', 'Inter', 'system-ui', 'sans-serif'],
        mono:     ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', '"Liberation Mono"', '"Courier New"', 'monospace'],
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'fade-in':    'fadeIn 0.3s ease-out',
        'slide-down': 'slideDown 0.25s ease-out',
        'blink':      'blink 1.2s step-end infinite',
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
      },
      boxShadow: {
        'primary-glow': '0 0 20px rgba(182,160,255,0.25)',
        'cyan-glow':    '0 0 20px rgba(0,238,252,0.15)',
        'card':         '0 4px 24px rgba(0,0,0,0.3)',
        'float':        '0 8px 48px rgba(0,0,0,0.3)',
      },
      borderRadius: {
        DEFAULT: '0.375rem',     // md
        sm:      '0.125rem',
        lg:      '0.5rem',
        xl:      '0.75rem',
      },
    },
  },
  plugins: [],
}
