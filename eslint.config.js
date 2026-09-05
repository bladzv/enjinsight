import js from '@eslint/js'
import reactHooks from 'eslint-plugin-react-hooks'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import globals from 'globals'

// Flat config (ESLint 10 — .eslintrc is not supported).
//
// react-hooks and jsx-a11y are the two plugins this project has been missing
// (see CLAUDE.md / audit history) — most of the accessibility findings from
// that audit are exactly what jsx-a11y/recommended catches automatically.
//
// eslint-plugin-react-hooks@7's own "recommended"/"recommended-latest" presets
// bundle a much larger React-Compiler-readiness rule set (purity, immutability,
// refs, set-state-in-effect, gating, ...) on top of the two classic hooks rules.
// This codebase was not written against that stricter set, and adopting it here
// would turn a lint-tooling change into a large, unrelated correctness pass.
// Only the two established hooks-correctness rules are enabled below; the rest
// of the v7 rule set is a candidate for its own follow-up, not bundled silently
// into this change.
const reactHooksCoreRules = {
  'react-hooks/rules-of-hooks': 'error',
  'react-hooks/exhaustive-deps': 'warn',
}

export default [
  js.configs.recommended,

  {
    ignores: ['dist/**', 'node_modules/**', 'indexer/**', '.venv/**'],
  },

  {
    rules: {
      // Every occurrence in this codebase is a deliberate best-effort cleanup
      // (closing a socket, clearing a cache entry) where the failure is
      // expected and genuinely not actionable — not a masked bug. This is the
      // documented option for exactly that pattern, rather than 25 call sites
      // each getting a `/* noop */` comment to satisfy the rule.
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },

  // Browser app code
  {
    files: ['src/**/*.{js,jsx}'],
    plugins: {
      'react-hooks': reactHooks,
      'jsx-a11y': jsxA11y,
    },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
      globals: {
        ...globals.browser,
        // Injected by vite.config.js's `define` from package.json at build
        // time. Read through a `typeof` guard in scanEnvelope.js so a bare
        // Node import degrades to 'unknown' instead of throwing.
        __APP_VERSION__: 'readonly',
      },
    },
    rules: {
      ...reactHooksCoreRules,
      ...jsxA11y.flatConfigs.recommended.rules,
      // BigInt/large numeric literals and the vite `import.meta.env.PROD` guard
      // used throughout constants.js are legitimate here, not lint targets.
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },

  // Test files: same environment as app code, tests may intentionally alias
  // unused destructured values.
  {
    files: ['src/**/*.test.{js,jsx}'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },

  // Vercel serverless function — Node runtime, not the browser.
  {
    files: ['api/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },

  // Vite config itself runs under Node at build time.
  {
    files: ['vite.config.js', 'postcss.config.js', 'tailwind.config.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
  },
]
