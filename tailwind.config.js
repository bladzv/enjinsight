/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        ink:     '#08080E',
        surface: '#0F0F1A',
        card:    '#13131F',
        border:  '#1E1E35',
        rim:     '#2A2A45',
        primary: '#7B3FE4',
        'primary-dim': '#5A2DB0',
        'primary-glow': '#9B5FFF',
        cyan:    '#00D4FF',
        'cyan-dim': '#00A3CC',
        success: '#22C55E',
        warning: '#F59E0B',
        danger:  '#EF4444',
        dim:     '#8B8AB0',
        muted:   '#4A4A6A',
        text:    '#F0EEFF',
        'text-secondary': '#A9A8CC',
        term:    '#050508',
      },
      fontFamily: {
        sans: ['Sora', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', '"Fira Code"', 'monospace'],
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
        'primary-glow': '0 0 20px rgba(123,63,228,0.35)',
        'cyan-glow':    '0 0 20px rgba(0,212,255,0.25)',
        'card':         '0 4px 24px rgba(0,0,0,0.4)',
      },
    },
  },
  plugins: [],
}
