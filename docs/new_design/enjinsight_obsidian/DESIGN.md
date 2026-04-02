# Design System Specification: The Kinetic Ledger

## 1. Overview & Creative North Star
### The Creative North Star: "The Digital Observatory"
This design system moves away from the "flat dashboard" trope. Instead, it treats blockchain data as a living, breathing architectural space. We are building a "Digital Observatory"—a high-fidelity lens that brings clarity to the chaotic, high-density world of on-chain analytics.

To break the "template" look, we employ **Intentional Asymmetry** and **Tonal Depth**. By shifting away from rigid 1px borders and moving toward nested surface elevations, the UI feels like a sophisticated terminal rather than a generic web app. We use a "High-Contrast Editorial" approach to typography, pairing the brutalist efficiency of Space Grotesk with the Swiss precision of Inter.

---

## 2. Colors & Surface Architecture

### The Palette
We utilize a spectrum of deep navies and electric purples to establish a "Technical Premium" atmosphere.

*   **Primary Core:** `primary` (#b6a0ff) and `primary_dim` (#8051ff). These are used for high-signal actions.
*   **The Signal Accents:** `secondary` (#00eefc) for data visualization "Cyber Blue," `tertiary` (#8eff71) for success states, and `error` (#ff6e84) for critical failures.

### The "No-Line" Rule
**Explicit Instruction:** Designers are prohibited from using 1px solid borders to section off major UI areas. 
*   Boundaries must be defined by background color shifts (e.g., a `surface_container_low` card sitting on a `surface` background). 
*   Structural definition comes from the **Spacing Scale** and **Tonal Layering**, not lines.

### Surface Hierarchy & Nesting
Treat the UI as a series of physical layers. Use the following tokens to create "nested" depth:
1.  **Base Layer:** `surface` (#0c0e17) - The infinite void of the application background.
2.  **Section Layer:** `surface_container_low` (#11131d) - Large logical groupings (e.g., a sidebar or main content well).
3.  **Component Layer:** `surface_container` (#171924) - Standard cards or table backgrounds.
4.  **Interaction Layer:** `surface_bright` (#282b3a) - Hover states or active focal points.

### The "Glass & Gradient" Rule
For floating elements (Modals, Tooltips, or Popovers), use **Glassmorphism**:
*   **Fill:** `surface_container_high` (#1c1f2b) at 80% opacity.
*   **Effect:** `backdrop-filter: blur(12px)`.
*   **Signature Texture:** Use a subtle linear gradient on primary CTAs transitioning from `primary_dim` to `primary` at a 135° angle.

---

## 3. Typography
Our typography is designed for "Data Skimming"—the ability to find a needle in a digital haystack.

*   **Display & Headlines (Space Grotesk):** These are our "Editorial Anchors." Use `display-lg` to `headline-sm` for page titles and high-level metrics. The geometric nature of Space Grotesk provides a technical, authoritative "Brutalist" feel.
*   **UI & Body (Inter):** All functional UI, labels, and paragraph text use Inter. It is the workhorse of the system, providing maximum readability at small sizes.
*   **Monospace (System Mono):** Essential for blockchain addresses and hash strings. Use `label-sm` with Monospace for all terminal logs and transaction IDs to ensure character alignment.

---

## 4. Elevation & Depth

### The Layering Principle
Avoid "Drop Shadows" as a crutch for hierarchy. Instead, stack the surface tiers. A `surface_container_lowest` (#000000) element placed inside a `surface_container_high` creates an "inset" terminal feel, perfect for code blocks or log panels.

### Ambient Shadows
When an element must "float" (e.g., a context menu):
*   **Blur:** `24px` to `48px`.
*   **Opacity:** 6%–10%.
*   **Color:** Use a tinted shadow derived from `on_surface` (a very dark navy) rather than pure black.

### The "Ghost Border" Fallback
If a border is required for accessibility in data-dense tables:
*   Use the `outline_variant` (#464752) token at **15% opacity**.
*   This creates a "ghost" line that guides the eye without cluttering the visual field.

---

## 5. Components

### High-Density Data Tables
*   **Style:** Forbid horizontal dividers. Use `surface_container_low` for the header row and a subtle `surface_container` shift on row-hover.
*   **Vertical Space:** Use `spacing-4` (0.9rem) for cell padding to maintain "breathing room" amidst high density.

### Terminal Log Panels
*   **Background:** `surface_container_lowest` (#000000).
*   **Text:** `on_surface_variant` (#aaaab7) for timestamps, `primary` (#b6a0ff) for status.
*   **Corner Radius:** `md` (0.375rem).

### Interactive Charts (Chart.js Style)
*   **Line Weights:** 2px stroke width for primary data lines.
*   **Fills:** Use a 10% opacity gradient fill below the line using the `secondary_dim` token.
*   **Grid Lines:** Use `outline_variant` at 5% opacity.

### Glassmorphic Action Chips
*   **Selection Chips:** Use `secondary_container` with a `secondary` glow (1px inner shadow) when active.
*   **Filter Chips:** `surface_bright` with a `sm` (0.125rem) roundedness scale.

### Buttons
*   **Primary:** Solid `primary` with `on_primary` text. No border. `md` roundedness.
*   **Secondary:** `surface_variant` background with `on_surface` text.
*   **Ghost:** Transparent background with `outline` text. Glows to `primary_dim` on hover.

---

## 6. Do's and Don'ts

### Do
*   **DO** use `spacing-10` and `spacing-12` to create massive gaps between major layout sections. This prevents the "Excel Spreadsheet" feel.
*   **DO** use Monospace for any string involving hex codes (0x...).
*   **DO** use `tertiary_container` for "Success" backgrounds to ensure the neon green text remains readable against the dark theme.

### Don't
*   **DON'T** use 100% opaque, high-contrast white borders. They "trap" the data and make the UI feel dated.
*   **DON'T** use standard grey shadows. Always tint shadows with the background navy to maintain color harmony.
*   **DON'T** use `display` or `headline` fonts for body copy or small labels. Space Grotesk loses legibility at small scales; Inter is the only choice for data.
*   **DON'T** use dividers between list items. Use the `spacing-2` (0.4rem) scale to create visual separation through "whitespace" instead.