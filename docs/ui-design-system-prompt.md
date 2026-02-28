# UI/UX Design System Prompt — Dark Tech Aesthetic

> **How to use this file:** Paste the relevant sections into your AI agent's system prompt or project instructions. Replace all `[PLACEHOLDER]` values with your project's specifics. The sections are modular — include only what applies to your usecase.

---

## Design Philosophy & Aesthetic Direction

The visual language is **dark, precise, and data-dense** — inspired by developer tooling, blockchain explorers, and network monitoring dashboards. It prioritises information clarity over decoration. Every visual decision earns its place by making data easier to read or interactions easier to understand.

**Tone:** Industrial-minimal. The palette is almost monochrome dark with two deliberate accent colours — one warm/purple for primary actions and brand, one cool/cyan for live status and data highlights. Think terminal meets polished SaaS.

**What makes it memorable:**
- A deep near-black background with a subtle dot-grid pattern that gives depth without noise
- Cards that feel slightly elevated using border + shadow rather than heavy background contrast
- A monospaced font pairing for data values that makes numbers feel precise and trustworthy
- Colour used sparingly — only for semantic meaning (status, severity, action), never decoration
- Micro-animations that confirm state changes without being distracting

**What to avoid:**
- White or light backgrounds
- Purple gradients on white (generic AI aesthetic)
- Rounded pill buttons everywhere
- Excessive use of shadows or glassmorphism blur
- More than two accent colours
- Inter, Roboto, or Arial as the primary typeface

---

## Typography

### Font Pairing

```html
<!-- Add to <head> — Google Fonts -->
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link
  href="https://fonts.googleapis.com/css2?family=Sora:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap"
  rel="stylesheet"
/>
```

| Role | Font | Weight | Usage |
|---|---|---|---|
| **Display / UI** | Sora | 400, 500, 600, 700 | All UI text, labels, headings, body |
| **Data / Code** | JetBrains Mono | 400, 500, 700 | Numbers, addresses, timestamps, code, terminal output |

**Why this pairing:** Sora has geometric, slightly techy letterforms without feeling cold. JetBrains Mono is purpose-built for readability at small sizes — critical when displaying long addresses, hashes, or numerical data.

### Tailwind Font Config

```js
// tailwind.config.js
theme: {
  extend: {
    fontFamily: {
      sans: ['Sora', 'system-ui', 'sans-serif'],
      mono: ['"JetBrains Mono"', '"Fira Code"', 'monospace'],
    },
  }
}
```

### Type Scale (Tailwind classes)

| Element | Class | Notes |
|---|---|---|
| App title | `text-base sm:text-lg font-semibold` | Responsive, never oversized |
| Section heading | `text-base font-semibold text-text` | Same size as body but bold |
| Card title / name | `text-sm font-semibold` | |
| Body / table cell | `text-sm` | Default reading size |
| Small label / muted | `text-xs text-dim` | Metadata, secondary info |
| Mono data value | `font-mono text-xs` or `text-sm` | Addresses, numbers, hashes |
| Terminal output | `font-mono text-xs` | Always monospaced |
| Input field | `text-base` on mobile, `text-lg` for prominent inputs | Never smaller than 16px on mobile |

**Rule:** Body text uses `text-sm` (14px) as the standard. Only use `text-base` (16px) for interactive inputs to prevent iOS auto-zoom. Never use `text-lg` or larger for body content — the density of this design relies on compact type.

---

## Colour System

### Palette

```js
// tailwind.config.js — extend.colors
colors: {
  // ── Backgrounds (darkest to least dark) ──────────────────────────────
  ink:     '#08080E',   // page background — near black with blue undertone
  surface: '#0F0F1A',   // elevated surface (inputs, table headers, panel bg)
  card:    '#13131F',   // card background
  term:    '#050508',   // terminal/log background — deepest black
  border:  '#1E1E35',   // default border
  rim:     '#2A2A45',   // hover border, scrollbar thumb

  // ── Primary — purple (action, brand, highlight) ───────────────────────
  primary:       '#7B3FE4',
  'primary-dim': '#5A2DB0',   // pressed/active state
  'primary-glow':'#9B5FFF',   // hover state

  // ── Accent — cyan (live status, data highlights, links) ───────────────
  cyan:     '#00D4FF',
  'cyan-dim':'#00A3CC',

  // ── Semantic ──────────────────────────────────────────────────────────
  success: '#22C55E',   // rewarded, active, confirmed
  warning: '#F59E0B',   // missed, waiting, caution
  danger:  '#EF4444',   // error, critical, failed

  // ── Text ──────────────────────────────────────────────────────────────
  text:            '#F0EEFF',   // primary text — warm near-white
  'text-secondary':'#A9A8CC',   // secondary text — muted blue-grey
  dim:             '#8B8AB0',   // tertiary / icon default
  muted:           '#4A4A6A',   // disabled, placeholder, very muted
}
```

### Colour Usage Rules

| Colour | When to use | When NOT to use |
|---|---|---|
| `primary` (#7B3FE4) | Primary buttons, active tab indicators, focused borders, brand accents | Background fills, text on dark bg (contrast may fail) |
| `cyan` (#00D4FF) | Live/scanning status indicator, external link hover, data highlights | Primary actions (that's primary's job) |
| `success` (#22C55E) | Confirmed/rewarded states, active badges, positive counts | Decoration |
| `warning` (#F59E0B) | Caution states, missed/pending, low-severity alerts | Errors (that's danger) |
| `danger` (#EF4444) | Errors, critical alerts, failed states, high severity | Warnings (that's warning) |
| `dim` (#8B8AB0) | Default icon colour, secondary labels, muted metadata | Primary readable text |
| `border` (#1E1E35) | Default card/input borders | |
| `rim` (#2A2A45) | Hover borders, scrollbar thumbs, active borders | |

### Semantic Colour Pairs

Always pair colour with a non-colour signal (icon, text label). Never use colour as the sole differentiator.

```
Active validator:  green  + Shield icon  + "Active" text
Waiting validator: gray   + Clock icon   + "Waiting" text
Rewarded era:      green  + CheckCircle2 icon
Missed era:        red    + XCircle icon + "No Reward" text
Critical alert:    red bg + AlertTriangle icon + descriptive text
```

---

## Background & Texture

### Dot-Grid Background

The page background uses a radial-gradient dot pattern layered over the solid dark colour. This adds depth and a technical/data-grid feel without visual noise.

```css
/* Global page background */
.bg-grid {
  background-color: #08080E;
  background-image: radial-gradient(circle, #2A2A45 1px, transparent 1px);
  background-size: 28px 28px;
}
```

```jsx
// Apply to the outermost page wrapper
<div className="min-h-dvh bg-ink bg-grid">
  {/* content */}
</div>
```

**Tuning the grid:**
- Dot colour `#2A2A45` (rim) — subtle, same hue family as background, just lighter
- Dot size: 1px — any larger becomes distracting
- Grid spacing: 28px — tight enough to feel like a grid, loose enough not to compete with content
- For a denser grid (more technical feel): reduce to 20px
- For a more subtle grid (less prominent): increase to 36px or reduce dot colour opacity

---

## Elevation System

Instead of heavy shadows or blur-based glassmorphism, elevation is created through border + minimal shadow combinations.

| Level | Usage | CSS |
|---|---|---|
| **Level 0** | Page background | `bg-ink` (bare) |
| **Level 1** | Cards, panels | `bg-card border border-border rounded-xl shadow-card` |
| **Level 2** | Inputs, table headers, sub-panels | `bg-surface border border-border` |
| **Level 3** | Tooltips, dropdowns (if needed) | `bg-card border border-rim shadow-lg` |

```js
// tailwind.config.js — custom shadow
boxShadow: {
  'card': '0 4px 24px rgba(0,0,0,0.4)',
  'primary-glow': '0 0 20px rgba(123,63,228,0.35)',
  'cyan-glow': '0 0 20px rgba(0,212,255,0.25)',
}
```

**The `.card` class:**
```css
.card {
  @apply bg-card border border-border rounded-xl shadow-card;
}
```

Use `rounded-xl` (12px) for cards and containers. Use `rounded-lg` (8px) for buttons and inputs. Use `rounded-full` only for badge pills and status dots.

---

## Component Library

### Buttons

Three button variants cover all use cases:

```css
/* Primary — for the single most important action on a screen */
.btn-primary {
  @apply inline-flex items-center justify-center gap-2 px-6 py-3 rounded-lg
         bg-primary hover:bg-primary-glow active:bg-primary-dim
         text-white font-semibold text-sm tracking-wide
         transition-all duration-150
         disabled:opacity-40 disabled:cursor-not-allowed
         focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2
         focus-visible:ring-offset-ink;
}

/* Ghost — for secondary actions, filters, pagination */
.btn-ghost {
  @apply inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg
         text-dim hover:text-text hover:bg-border
         text-xs font-medium transition-all duration-150
         focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1
         focus-visible:ring-offset-ink;
}

/* Icon — for icon-only actions (copy, link, expand, retry) */
/* CRITICAL: min 44×44px tap target for accessibility */
.btn-icon {
  @apply inline-flex items-center justify-center
         min-w-[44px] min-h-[44px] rounded-lg
         text-dim hover:text-text hover:bg-border
         transition-all duration-150
         focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1
         focus-visible:ring-offset-ink;
}
```

**Button sizing on mobile:** Primary buttons must be `min-h-[48px]` and full-width (`w-full`) on screens < 640px. Ghost and icon buttons maintain their 44px minimum.

**Loading state in primary button:**
```jsx
<button className="btn-primary" disabled>
  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
  Loading…
</button>
```

### Status Badges

```css
.badge-active  { @apply inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-success/15 text-success; }
.badge-waiting { @apply inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-muted/40 text-dim; }
.badge-error   { @apply inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-danger/15 text-danger; }
```

**Pattern:** `bg-[colour]/15` background (15% opacity) + full `text-[colour]`. This gives semantic meaning without overpowering the surrounding content. Always include an icon inside badges.

### Severity Chips

```css
.sev-low    { @apply inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-warning/15 text-warning; }
.sev-medium { @apply inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-orange-500/15 text-orange-400; }
.sev-high   { @apply inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-danger/15 text-danger; }
```

### Input Fields

```jsx
<input
  className={`
    w-full px-4 py-3 rounded-lg bg-surface border text-text
    text-base font-mono placeholder-muted
    focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary
    transition-colors disabled:opacity-50 disabled:cursor-not-allowed
    ${hasError ? 'border-danger focus:ring-danger' : 'border-border'}
  `}
/>
```

Key rules:
- Background: `bg-surface` (one step lighter than `bg-card`)
- Default border: `border-border`; error state: `border-danger`; focused: `border-primary`
- Always `text-base` or larger — prevents iOS auto-zoom on focus
- Use `font-mono` for data inputs (numbers, addresses, codes); `font-sans` for text inputs
- Placeholder: `placeholder-muted` — should barely be visible

### Cards (Expandable)

```jsx
<div className="card overflow-hidden transition-all duration-200">
  {/* Header row — the tap target */}
  <div
    role="button"
    tabIndex={0}
    onClick={toggle}
    onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && toggle()}
    aria-expanded={isOpen}
    className="flex items-center gap-3 px-4 py-3 cursor-pointer
               hover:bg-surface/40 transition-colors select-none min-h-[56px]"
  >
    {/* content */}
    {isOpen ? <ChevronUp size={16} className="text-dim" /> : <ChevronDown size={16} className="text-dim" />}
  </div>

  {/* Expanded body */}
  {isOpen && (
    <div className="border-t border-border animate-fade-in">
      {/* expanded content */}
    </div>
  )}
</div>
```

**Left accent border pattern** for cards with a notable status:
```jsx
<div className={`card ${hasWarning ? 'border-l-2 border-l-warning' : ''}`}>
```

### Tables

```jsx
{/* Always wrap in a scroll container for mobile */}
<div className="overflow-x-auto rounded-lg border border-border">
  <table className="w-full text-xs min-w-[480px]">
    <thead>
      <tr className="bg-surface border-b border-border">
        <th className="text-left px-3 py-2.5 font-semibold text-dim">Column</th>
      </tr>
    </thead>
    <tbody>
      <tr className="border-b border-border/50 hover:bg-surface/50 transition-colors">
        <td className="px-3 py-2.5 text-text">Value</td>
      </tr>
    </tbody>
  </table>
</div>
```

**Table rules:**
- `text-xs` for table content — this is data-dense UI
- Header: `bg-surface border-b border-border` + `text-dim font-semibold`
- Row hover: `hover:bg-surface/50 transition-colors`
- Row separator: `border-b border-border/50` (lighter than card border)
- Right-align numeric columns: `text-right font-mono`
- Alternating row shading (optional): `bg-surface/20` on even rows
- Always `min-w-[Npx]` on the table + `overflow-x-auto` on the wrapper — never let tables break the layout

**Hiding columns on mobile:**
```jsx
<th className="hidden md:table-cell">Stake</th>
<td className="hidden md:table-cell">value</td>
```

### Tab Bar (inside expanded cards)

```jsx
<div className="flex border-b border-border bg-surface/50">
  <button
    onClick={() => setTab('first')}
    className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium border-b-2 transition-colors
      ${activeTab === 'first'
        ? 'border-primary text-primary'
        : 'border-transparent text-dim hover:text-text'}`}
    aria-selected={activeTab === 'first'}
  >
    <IconComponent size={13} />
    Tab Label
    {/* Optional badge */}
    <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-border text-dim">
      {count}
    </span>
  </button>
</div>
```

### Terminal / Log Drawer

The terminal is a collapsible panel with a distinct deepest-black background that separates it visually from all other surfaces.

```jsx
<div className="card overflow-hidden font-mono text-xs">
  {/* Toggle bar */}
  <button
    onClick={toggle}
    className="w-full flex items-center gap-2 px-4 py-2.5 bg-term hover:bg-surface/80
               transition-colors text-left"
    aria-expanded={isExpanded}
  >
    <Terminal size={13} className="text-primary flex-shrink-0" />
    <span className="text-dim text-[11px] font-semibold uppercase tracking-widest">Logs</span>
    <span className="flex-1 truncate text-dim ml-2">{lastLogLine}</span>
    <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] bg-border text-dim">{count}</span>
    {isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
  </button>

  {/* Log body */}
  {isExpanded && (
    <div
      className="bg-term overflow-y-auto"
      style={{ maxHeight: 'min(300px, 40vh)' }}
      role="log"
      aria-live="polite"
    >
      <div className="px-4 py-3 space-y-0.5">
        {entries.map(entry => (
          <div key={entry.id} className="flex gap-2 items-start leading-relaxed">
            <span className="text-muted flex-shrink-0 select-none">{entry.timestamp}</span>
            <span className={`flex-shrink-0 select-none ${levelClass[entry.level]}`}>
              [{entry.level}]
            </span>
            <span className="text-[#C8C8E8] break-all">{entry.message}</span>
          </div>
        ))}
      </div>
    </div>
  )}
</div>
```

**Log level colours:**
```js
const levelClass = {
  INFO: 'text-cyan',    // blue-ish — neutral operational
  OK:   'text-success', // green — success
  WARN: 'text-warning', // amber — caution
  ERR:  'text-danger',  // red — failure
  DONE: 'text-primary-glow', // purple — completion
}
```

### Alert / Banner

```jsx
{/* Critical alert banner */}
<div
  role="alert"
  className="flex gap-3 px-4 py-3 rounded-xl bg-danger/10 border border-danger/30 animate-fade-in"
>
  <AlertTriangle size={16} className="text-danger flex-shrink-0 mt-0.5" />
  <div className="text-xs leading-relaxed">
    <span className="font-semibold text-danger">Critical: </span>
    <span className="text-text">Descriptive message here.</span>
  </div>
</div>

{/* Warning banner (proxy/config notice) */}
<div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-warning/10 border border-warning/30 text-xs text-warning">
  <AlertCircle size={13} />
  <span>Warning message here.</span>
  <button className="ml-auto underline hover:no-underline">Action</button>
</div>
```

### Stat Chips (Summary / KPI)

```jsx
<div className="grid grid-cols-3 gap-3">
  {[
    { value: 42, label: 'Total Items', colour: 'text-text',    bg: 'bg-border/40'   },
    { value: 38, label: 'Success',     colour: 'text-success', bg: 'bg-success/10'  },
    { value: 4,  label: 'With Issues', colour: 'text-warning', bg: 'bg-warning/10'  },
  ].map(chip => (
    <div key={chip.label} className={`${chip.bg} rounded-xl p-3 sm:p-4 text-center`}>
      <div className={`text-2xl sm:text-3xl font-bold ${chip.colour} leading-none`}>
        {chip.value}
      </div>
      <div className="text-xs text-dim mt-1">{chip.label}</div>
    </div>
  ))}
</div>
```

---

## Layout System

### Page Structure

```jsx
<div className="min-h-dvh bg-ink bg-grid">
  {/* Zone 1: Sticky header */}
  <header className="sticky top-0 z-30 bg-ink/90 backdrop-blur border-b border-border">
    <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
      {/* Logo + title left, actions right */}
    </div>
  </header>

  {/* Zone 2–N: Main content */}
  <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-4 sm:space-y-5">
    {/* Stacked cards / sections */}
  </main>

  {/* Footer */}
  <footer className="border-t border-border mt-12 py-6 text-center text-xs text-muted">
    <p>App name · Data via <a href="#" target="_blank" rel="noopener noreferrer" className="text-dim hover:text-cyan transition-colors">Source</a></p>
  </footer>
</div>
```

### Content Width

- Max content width: `max-w-6xl` (72rem / 1152px) — centred with `mx-auto`
- Horizontal padding: `px-4` mobile, `px-6` sm+ (never `px-2` or `px-8`)
- Vertical section spacing: `space-y-4` mobile, `space-y-5` sm+

### Header

```jsx
<header className="sticky top-0 z-30 bg-ink/90 backdrop-blur border-b border-border">
  <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
    {/* Left: Logo mark + App name */}
    <div className="flex items-center gap-3 min-w-0">
      {/* Logo mark: small icon in a rounded square with primary/20 bg */}
      <div className="w-8 h-8 rounded-lg bg-primary/20 border border-primary/40 flex items-center justify-center flex-shrink-0">
        {/* SVG icon or Lucide icon here */}
      </div>
      <div className="min-w-0">
        <h1 className="text-sm sm:text-base font-semibold text-text leading-tight truncate">
          App Name
        </h1>
        <p className="text-xs text-dim hidden sm:block leading-none mt-0.5">Subtitle or context</p>
      </div>
    </div>

    {/* Right: Live status indicator + nav links */}
    <div className="flex items-center gap-2 flex-shrink-0">
      {/* External link — icon only on mobile, text + icon on sm+ */}
      <a href="#" target="_blank" rel="noopener noreferrer" className="btn-ghost">
        <span className="hidden sm:inline">Link Text</span>
        <ExternalLink size={14} />
      </a>
    </div>
  </div>
</header>
```

### Section Divider with Title

```jsx
<div className="flex items-center gap-2 mb-3">
  <h2 className="text-base font-semibold text-text">Section Title</h2>
  {/* Optional count badge */}
  <span className="px-2 py-0.5 rounded-full text-xs bg-border text-dim font-semibold">
    {count}
  </span>
  {/* Horizontal rule that fills remaining space */}
  <span className="h-px flex-1 bg-border" />
  {/* Optional right-aligned status text */}
  <span className="text-xs text-dim">Status text</span>
</div>
```

---

## Animation System

```js
// tailwind.config.js
animation: {
  'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
  'fade-in':    'fadeIn 0.3s ease-out',
  'slide-down': 'slideDown 0.25s ease-out',
  'blink':      'blink 1.2s step-end infinite',
  'spin':       'spin 1s linear infinite',  // built-in, shown for completeness
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
```

### When to use each animation

| Animation | Use case |
|---|---|
| `animate-fade-in` | Newly revealed content: expanded card body, alert banners, summary section on load |
| `animate-pulse-slow` | Live status dot in the header during active data fetching |
| `animate-spin` | Loading spinner inside buttons and card loading states |
| `animate-blink` | Cursor in terminal output (if simulating a live terminal) |
| `transition-all duration-200` | Card border/shadow changes on expand |
| `transition-colors duration-150` | Button hover states, row hover, tab switches |

**Rule:** Prefer `transition-colors` over `transition-all` when only colour changes — it's more performant. Use `transition-all` only when multiple properties (shadow, border, size) animate together.

---

## Icon System (Lucide React)

### Setup

```bash
npm install lucide-react
```

```jsx
// Always import individually — enables tree-shaking
import { Shield, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react'
```

### Standard Icon Sizes

| Context | Size prop | Notes |
|---|---|---|
| Inline with body text | `size={14}` | |
| Inside badges/chips | `size={10}` or `size={11}` | |
| Tab bar icons | `size={13}` | |
| Card section headers | `size={14}` or `size={16}` | |
| Alert banners | `size={16}` | Needs to stand out |
| Empty state illustration | `size={32}` or `size={40}` | |
| Standalone feature icons | `size={20}` or `size={24}` | |

### Recommended Icon Assignments by Semantic Role

| Role | Icon | Colour |
|---|---|---|
| Success / confirmed / rewarded | `CheckCircle2` | `text-success` |
| Error / failed / missed | `XCircle` | `text-danger` |
| Critical alert / warning | `AlertTriangle` | `text-warning` or `text-danger` |
| Info / notice | `AlertCircle` | `text-dim` |
| Active / verified status | `Shield` | `text-success` |
| Pending / waiting status | `Clock` | `text-dim` |
| Expand | `ChevronDown` | `text-dim` |
| Collapse | `ChevronUp` | `text-dim` |
| External link | `ExternalLink` | `text-dim` hover `text-cyan` |
| Copy to clipboard | `Copy` | `text-dim` |
| Copy confirmed | `CheckCircle2` | `text-success` |
| Retry / refresh | `RefreshCw` | context-dependent |
| Terminal / logs | `Terminal` | `text-primary` |
| Live / scanning | `Activity` | `text-cyan animate-pulse` |
| Settings / config | `Settings` | colour indicates status |
| Users / group | `Users` | `text-dim` or accent |
| Chart / data | `BarChart3` | `text-dim` or accent |
| Search / filter | `Search` | `text-dim` |
| Download / export | `Download` | `text-primary` |
| Filter / sort controls | `SlidersHorizontal` | `text-dim` |

### Icon-Only Button Accessibility

**Always** provide `aria-label` on icon-only buttons:

```jsx
<button
  className="btn-icon"
  aria-label="Copy address to clipboard"
  onClick={handleCopy}
>
  {copied ? <CheckCircle2 size={13} className="text-success" /> : <Copy size={13} />}
</button>
```

---

## Responsive Design System

### Breakpoints (Tailwind default, mobile-first)

| Breakpoint | Width | Layout behaviour |
|---|---|---|
| `default` | < 640px | Single column; full-width buttons; tables horizontally scrollable; drawers shorter |
| `sm` | ≥ 640px | Input + button row; increased padding |
| `md` | ≥ 768px | Two-column grids (e.g. stat chips); table extra columns visible |
| `lg` | ≥ 1024px | Full desktop layout; side-by-side panels if needed |
| `xl` | ≥ 1280px | Content max-width capped; generous negative space |

### Mobile-First Card Pattern

Cards must handle two different header layouts:

```jsx
{/* Collapsed card header — wraps gracefully on mobile */}
<div className="flex items-center gap-2 sm:gap-3 px-4 py-3 cursor-pointer min-h-[56px]">
  {/* Status badge — always visible */}
  <span className="badge-active flex-shrink-0">...</span>

  {/* Name block — takes up remaining space, truncates */}
  <div className="flex-1 min-w-0">
    {/* Line 1 — name + inline icons */}
    <div className="flex items-center gap-1.5 min-w-0">
      <span className="font-semibold text-sm truncate">{name}</span>
      {/* Status icon inline */}
    </div>
    {/* Line 2 — secondary metadata (mobile shows this inline) */}
    <div className="flex items-center gap-3 mt-0.5">
      <span className="text-xs text-dim">Label: <span className="text-text-secondary">value</span></span>
      {/* Hide verbose secondary info on mobile */}
      <span className="text-xs text-dim hidden sm:inline">More: <span className="font-mono text-text-secondary">value</span></span>
    </div>
  </div>

  {/* Value — hidden on mobile (shown in line 2 instead), visible md+ */}
  <span className="font-mono text-xs text-text-secondary hidden md:block flex-shrink-0">
    {primaryValue}
  </span>

  {/* Icon actions — always visible but compact */}
  <div className="flex items-center gap-0.5 flex-shrink-0">
    {/* icon buttons */}
  </div>

  {/* Expand chevron — always rightmost */}
  <div className="text-dim flex-shrink-0">
    {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
  </div>
</div>
```

### Table Column Hiding Strategy

```jsx
{/* Progressively reveal columns at wider breakpoints */}
<th className="text-left px-3 py-2.5 font-semibold text-dim">Always Visible</th>
<th className="text-right px-3 py-2.5 font-semibold text-dim hidden sm:table-cell">Tablet+</th>
<th className="text-right px-3 py-2.5 font-semibold text-dim hidden md:table-cell">Desktop+</th>

{/* Reduce column span on mobile when columns hidden */}
<td className="px-3 py-2.5 text-danger" colSpan={3}>
  <span className="hidden md:inline">Full descriptive label</span>
  <span className="inline md:hidden">Short label</span>
</td>
```

### Touch Targets

```css
/* Minimum 44×44px on all interactive elements */
.btn-icon {
  min-width: 44px;
  min-height: 44px;
}

/* Primary action buttons on mobile: full width, taller */
@media (max-width: 639px) {
  .btn-primary {
    width: 100%;
    min-height: 48px;
  }
}
```

**Expand the tap zone for entire rows/cards on mobile:**
```jsx
{/* Make the entire card header the tap target — not just the chevron */}
<div
  onClick={toggle}
  className="cursor-pointer" // entire row is clickable
>
```

### Responsive Drawer/Panel Heights

```jsx
{/* Terminal / collapsible drawer */}
<div style={{ maxHeight: 'min(300px, 40vh)' }}>
  {/* 300px on desktop, 40% of viewport on mobile/tablet */}
</div>
```

---

## Accessibility Standards

### Required on Every Interactive Element

```jsx
{/* Keyboard navigation */}
onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && handler()}

{/* Focus ring — always use focus-visible (not focus) to avoid showing ring on click */}
className="focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-ink"

{/* Descriptive labels */}
aria-label="Action description for screen readers"

{/* State communication */}
aria-expanded={isOpen}
aria-selected={isActive}
aria-invalid={!!errorMessage}
aria-describedby="error-message-id"
```

### Live Regions

```jsx
{/* For dynamic content that updates without user action */}
<div role="log" aria-live="polite" aria-label="Activity log">
  {/* Terminal entries */}
</div>

<div role="alert">
  {/* Critical alerts — announced immediately */}
</div>

<p id="era-count-error" role="alert" className="mt-1.5 text-xs text-danger">
  {errorMessage}
</p>
```

### Global Focus Style

```css
/* Override browser default focus ring sitewide */
:focus-visible {
  outline: 2px solid theme('colors.primary');
  outline-offset: 2px;
  border-radius: 4px;
}
```

### Colour Contrast Minimums

| Text type | Minimum ratio | Notes |
|---|---|---|
| Normal body text | 4.5:1 | WCAG AA |
| Large text (18px+ or 14px+ bold) | 3:1 | WCAG AA |
| UI component boundaries | 3:1 | Buttons, inputs |
| Decorative elements | No requirement | Dot grid, dividers |

All text/background combinations in this palette meet AA:
- `text-text` (#F0EEFF) on `bg-card` (#13131F): ~12:1 ✓
- `text-dim` (#8B8AB0) on `bg-card` (#13131F): ~4.6:1 ✓
- `text-success` (#22C55E) on `bg-card` (#13131F): ~5.4:1 ✓
- `text-warning` (#F59E0B) on `bg-card` (#13131F): ~7.1:1 ✓
- `text-danger` (#EF4444) on `bg-card` (#13131F): ~5.1:1 ✓

---

## CSS Global Styles (index.css)

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  *, *::before, *::after { box-sizing: border-box; }
  html { scroll-behavior: smooth; }
  body { @apply bg-ink text-text font-sans antialiased; min-height: 100dvh; }

  :focus-visible {
    outline: 2px solid theme('colors.primary');
    outline-offset: 2px;
    border-radius: 4px;
  }

  ::selection { background: theme('colors.primary'); color: white; }

  /* Consistent thin scrollbars */
  ::-webkit-scrollbar { width: 6px; height: 6px; }
  ::-webkit-scrollbar-track  { background: theme('colors.surface'); }
  ::-webkit-scrollbar-thumb  { background: theme('colors.rim'); border-radius: 3px; }
  ::-webkit-scrollbar-thumb:hover { background: theme('colors.primary-dim'); }
}

@layer components {
  .bg-grid {
    background-image: radial-gradient(circle, #2A2A45 1px, transparent 1px);
    background-size: 28px 28px;
  }
  .card { @apply bg-card border border-border rounded-xl shadow-card; }
  .btn-primary { /* see Button section */ }
  .btn-ghost   { /* see Button section */ }
  .btn-icon    { /* see Button section */ }
  .badge-active  { @apply inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-success/15 text-success; }
  .badge-waiting { @apply inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-muted/40 text-dim; }
  .badge-error   { @apply inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-danger/15 text-danger; }
  .sev-low       { @apply inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-warning/15 text-warning; }
  .sev-medium    { @apply inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-orange-500/15 text-orange-400; }
  .sev-high      { @apply inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-danger/15 text-danger; }
  .log-info { @apply text-cyan; }
  .log-ok   { @apply text-success; }
  .log-warn { @apply text-warning; }
  .log-err  { @apply text-danger; }
  .log-done { @apply text-primary-glow; }
  .log-ts   { @apply text-muted; }
}

@layer utilities {
  .scrollbar-thin { scrollbar-width: thin; }
  .scroll-x { overflow-x: auto; -webkit-overflow-scrolling: touch; }
  .addr { @apply font-mono text-xs text-text-secondary; word-break: break-all; }
}
```

---

## Complete Tailwind Config

```js
// tailwind.config.js
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink:             '#08080E',
        surface:         '#0F0F1A',
        card:            '#13131F',
        border:          '#1E1E35',
        rim:             '#2A2A45',
        term:            '#050508',
        primary:         '#7B3FE4',
        'primary-dim':   '#5A2DB0',
        'primary-glow':  '#9B5FFF',
        cyan:            '#00D4FF',
        'cyan-dim':      '#00A3CC',
        success:         '#22C55E',
        warning:         '#F59E0B',
        danger:          '#EF4444',
        dim:             '#8B8AB0',
        muted:           '#4A4A6A',
        text:            '#F0EEFF',
        'text-secondary':'#A9A8CC',
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
        fadeIn:    { '0%': { opacity: 0, transform: 'translateY(-4px)' }, '100%': { opacity: 1, transform: 'translateY(0)' } },
        slideDown: { '0%': { opacity: 0, maxHeight: '0px' }, '100%': { opacity: 1, maxHeight: '2000px' } },
        blink:     { '0%, 100%': { opacity: 1 }, '50%': { opacity: 0 } },
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
```

---

## Tech Stack Defaults

These are the default tech choices this design system is built and tested against. Swap as needed for your project.

| Layer | Default | Alternatives |
|---|---|---|
| Framework | React 18 (Vite) | Next.js, Svelte, Vue |
| Styling | Tailwind CSS v3 | — (design tokens above translate directly) |
| Icons | `lucide-react` | Any icon library — sizes above still apply |
| Fonts | Google Fonts (Sora + JetBrains Mono) | Self-hosted or swap fonts — maintain the sans/mono split |
| Animations | Tailwind keyframes | Framer Motion, CSS transitions |

### Vite Base Config for Static Deployment

```js
// vite.config.js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: './',        // relative — works at any subdirectory path (GitHub Pages, etc.)
  build: {
    outDir: 'dist',
    sourcemap: false, // never expose source maps in production
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
          icons:  ['lucide-react'],
        },
      },
    },
  },
})
```

---

## Design System Quick-Reference for AI Agents

> Paste this block into a prompt when you want an agent to follow this design system without sharing the full document.

```
Design system rules to follow strictly:

PALETTE
- Page bg: #08080E (ink) with 28px radial dot-grid (#2A2A45, 1px dots)
- Card bg: #13131F with border #1E1E35 and border-radius 12px
- Input/panel bg: #0F0F1A (surface)
- Terminal bg: #050508 (term)
- Primary: #7B3FE4 (hover #9B5FFF, active #5A2DB0)
- Accent: #00D4FF (cyan — live status, links)
- Success: #22C55E | Warning: #F59E0B | Danger: #EF4444
- Text: #F0EEFF | Secondary: #A9A8CC | Dim: #8B8AB0 | Muted: #4A4A6A

TYPOGRAPHY
- UI font: Sora (Google Fonts) — weights 400/500/600/700
- Data font: JetBrains Mono — for numbers, addresses, timestamps, terminal
- Body text: text-sm (14px). Inputs: text-base (16px). Never smaller than 12px.

COMPONENTS
- Cards: bg-card + border border-border + rounded-xl + shadow (0 4px 24px rgba(0,0,0,0.4))
- Primary button: bg-primary rounded-lg px-6 py-3 text-white font-semibold text-sm
- Ghost button: text-dim hover:text-text hover:bg-border rounded-lg text-xs
- Icon button: min 44×44px tap target, text-dim hover:text-text hover:bg-border
- Badges: bg-[colour]/15 text-[colour] rounded-full px-2 py-0.5 text-xs font-semibold
- Status always paired with icon + text — never colour alone

LAYOUT
- Max content width: 1152px (max-w-6xl) centred
- Padding: px-4 mobile, px-6 sm+
- Sticky header: h-14 bg-ink/90 backdrop-blur border-b border-border
- Section spacing: space-y-4 mobile, space-y-5 sm+

ICONS
- Use lucide-react, imported individually
- Default size: 14px inline, 13px in tabs, 16px in alerts, 10-11px inside badges
- Always aria-label on icon-only buttons

ANIMATIONS
- Newly revealed content: animate-fade-in (opacity 0→1 + translateY -4→0, 0.3s)
- Hover transitions: transition-colors duration-150
- Loading spinner: border-2 border-white/30 border-t-white rounded-full animate-spin w-4 h-4

RESPONSIVE (mobile-first)
- Tables: min-w + overflow-x-auto wrapper; hide non-essential columns below md
- Cards: entire header row is tap target on mobile
- Touch targets: minimum 44×44px
- Primary button: full-width min-h-[48px] on mobile

DARK THEME RULES
- Never use white or light backgrounds
- Never use colour as the only status indicator
- Never use Inter, Roboto, or Arial as primary font
- Never use purple gradient on white (generic AI aesthetic)
- Dot-grid always on the outermost page wrapper only
```

---

*This design system document is project-agnostic. Replace `[PLACEHOLDER]` values, adapt the icon assignments to your semantic domain, and keep the palette, typography, and component patterns intact.*
