---
name: X Media
description: A calm, information-dense workspace for finding and inspecting public X signals.
colors:
  action-light: "#0d366b"
  action-dark: "#3987e5"
  action-ink-light: "#ffffff"
  action-ink-dark: "#07182c"
  focus-light: "#2a78d6"
  canvas-light: "#f9f9f7"
  canvas-dark: "#0d0d0d"
  surface-light: "#fcfcfb"
  surface-dark: "#1a1a19"
  subtle-light: "#f0efec"
  subtle-dark: "#282826"
  ink-light: "#0b0b0b"
  ink-dark: "#ffffff"
  muted-ink-light: "#61605c"
  muted-ink-dark: "#b0afa8"
  accent-soft-light: "#e8f1fb"
  accent-soft-dark: "#22354a"
  border-light: "rgba(11, 11, 11, 0.11)"
  border-dark: "rgba(255, 255, 255, 0.10)"
  danger-light: "#d03b3b"
  danger-dark: "#e66767"
  signal-orange: "#eb6834"
  signal-green: "#1baf7a"
  signal-amber: "#eda100"
  signal-pink: "#e87ba4"
typography:
  display:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "clamp(1.875rem, 4vw, 2.25rem)"
    fontWeight: 600
    lineHeight: 1.12
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.35
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: 1.375
  body:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.33
    letterSpacing: "0.025em"
  mono:
    fontFamily: "Geist Mono, ui-monospace, monospace"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.33
rounded:
  sm: "calc(0.7rem * 0.6)"
  md: "calc(0.7rem * 0.8)"
  lg: "0.7rem"
  xl: "calc(0.7rem * 1.4)"
  pill: "9999px"
spacing:
  1: "0.25rem"
  2: "0.5rem"
  3: "0.75rem"
  4: "1rem"
  5: "1.25rem"
  6: "1.5rem"
  8: "2rem"
components:
  navigation-header:
    backgroundColor: "{colors.canvas-light}"
    textColor: "{colors.ink-light}"
    typography: "{typography.body}"
    height: "4rem"
  button-primary:
    backgroundColor: "{colors.action-light}"
    textColor: "{colors.action-ink-light}"
    typography: "{typography.body}"
    rounded: "{rounded.lg}"
    padding: "0.375rem 0.625rem"
    height: "2rem"
  button-outline:
    backgroundColor: "{colors.canvas-light}"
    textColor: "{colors.ink-light}"
    typography: "{typography.body}"
    rounded: "{rounded.lg}"
    padding: "0.375rem 0.625rem"
    height: "2rem"
  input-search:
    backgroundColor: "{colors.surface-light}"
    textColor: "{colors.ink-light}"
    typography: "{typography.body}"
    rounded: "{rounded.lg}"
    padding: "0.5rem 0.625rem"
    height: "2.75rem"
  chip-filter:
    backgroundColor: "{colors.canvas-light}"
    textColor: "{colors.ink-light}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "0.25rem 0.625rem"
    height: "1.75rem"
  card-metric:
    backgroundColor: "{colors.surface-light}"
    textColor: "{colors.ink-light}"
    rounded: "{rounded.xl}"
    padding: "1rem"
  card-media:
    backgroundColor: "{colors.surface-light}"
    textColor: "{colors.ink-light}"
    rounded: "{rounded.xl}"
  alert-info:
    backgroundColor: "{colors.surface-light}"
    textColor: "{colors.ink-light}"
    typography: "{typography.body}"
    rounded: "{rounded.lg}"
    padding: "0.5rem 0.625rem"
---

# Design System: X Media

## Overview

**Creative North Star: "The Quiet Signal Room"**

X Media is a calm operational workspace where evidence is more prominent than decoration. Warm neutral canvases, compact controls, precise blue actions, and disciplined data density make the interface feel like a trusted research desk rather than a generic social dashboard. The visual system supports prolonged scanning in both light and dark themes without becoming clinical.

Hierarchy comes from measured type, tonal surface changes, thin borders, and selective elevation. Product identity appears in the small play mark, data-aware accent colors, and carefully written state labels; it never competes with the operator's task. Media can become visually dominant inside its own frame, while the surrounding interface remains quiet and regular.

**Key Characteristics:**

- Warm near-neutral light and dark canvases rather than pure gray application chrome.
- Geist typography with compact labels, tabular numerals, and restrained headline scale.
- Blue reserved for primary action, focus, progress, and the strongest live signal.
- Rounded rectangular controls and cards with thin borders and minimal ambient shadow.
- Responsive density that preserves every control and metric before changing the layout.

## Colors

The palette is neutral-first: deep blue provides authority, bright blue provides interaction, and a small set of clear accents identifies status or data series without turning the workspace colorful by default.

### Primary

- **Deep Signal Blue:** The light-theme action color for primary buttons and decisive calls to action.
- **Live Signal Blue:** The dark-theme action color and the shared focus, chart, and progress emphasis.
- **Signal Mist:** A quiet blue-tinted background for selected or informative states.

### Secondary

- **Signal Orange:** A warm comparative chart series or metric accent.
- **Signal Green:** Positive, active, or healthy status and chart data.
- **Signal Amber:** Demo, caution, or attention states that are not errors.
- **Signal Pink:** A sparingly used fifth data-series accent.

### Neutral

- **Warm Canvas:** The light application background; slightly softened so white content never feels stark.
- **Night Canvas:** The dark application background; near-black rather than blue-black.
- **Paper Surface:** Cards, popovers, and elevated reading surfaces in light mode.
- **Charcoal Surface:** Cards, popovers, and media metadata surfaces in dark mode.
- **Quiet Fill:** Filters, inactive navigation, segmented-control tracks, and secondary controls.
- **Graphite Ink:** Primary light-theme text and structural marks.
- **White Ink:** Primary dark-theme text and text on Deep Signal Blue.
- **Muted Ink:** Supporting copy, timestamps, metadata, and low-priority labels.
- **Hairline:** Low-contrast separators and outlines that structure the workspace without drawing boxes around everything.
- **Operational Red:** Invalid, destructive, and incomplete states; never used as decoration.

**The Blue Means Action Rule.** Use blue for the primary action, focus, progress, or an explicit data signal. Do not spend it on decorative page furniture.

**The Neutral Majority Rule.** Neutral canvas and surface colors should occupy most of every operational screen; semantic accents stay local to the data or state they explain.

## Typography

**Display Font:** Geist (with system sans-serif fallback)
**Body Font:** Geist (with system sans-serif fallback)
**Label/Mono Font:** Geist Mono for code-like values when a fixed-width treatment is useful

**Character:** Geist gives the product a precise, contemporary voice without adding editorial drama. Weight and size shifts are deliberately small; hierarchy depends on rhythm, placement, and contrast as much as scale.

### Hierarchy

- **Display** (semibold, fluid 30-36px, 1.12 line-height): Focused surface introductions and no more than one primary statement per view.
- **Headline** (semibold, 18px, 1.35 line-height): Page titles and high-level section identity.
- **Title** (semibold, 16px, 1.375 line-height): Card groups, sheet titles, and important names.
- **Body** (regular, 14px, 1.5 line-height): Operational copy, post content, descriptions, and instructions; increase to 16px only where reading or input comfort benefits.
- **Label** (medium, 12px, 0.025em tracking): Metadata, controls, uppercase metric captions, timestamps, and compact state language.

**The Compact Hierarchy Rule.** Build hierarchy with semibold weight, muted color, spacing, and alignment before reaching for a larger type size.

**The Numeric Scan Rule.** Counts and metrics use tabular numerals; metric values may rise to 24-30px while their labels remain compact and muted.

## Layout

X Media uses a dense responsive workspace rather than a marketing-page rhythm. The dashboard places a fixed 256px sidebar beside a fluid content region capped at 1500px; focused utilities use centered containers capped at 1280px, with narrower 768px reading and entry regions inside them. Page gutters are 16px on mobile, 24px from the small breakpoint, and 32px on large screens. The recurring spacing rhythm is 4, 8, 12, 16, 24, and 32px.

Cards and controls pack tightly enough for scanning: 12-16px interior padding, 12-16px grid gaps, and 64px sticky headers. Desktop summary grids expand from one column to two and then four; complex dashboard regions can use a 12-column grid. Media grids grow from one to two, three, and four columns while retaining a consistent 4:3 preview.

At narrow widths, preserve content and intent rather than miniature the desktop layout. The sidebar becomes a sheet, header labels can collapse to icons, related controls stack, primary form actions become full-width, metrics become a single column, and filter groups may scroll horizontally. Sheets and dialogs use dynamic viewport limits so controls remain reachable above browser and safe-area UI.

**The Preserve-Then-Reflow Rule.** Keep every decision and status visible; change columns, stacking, and labels before hiding functionality.

## Elevation & Depth

The system is flat by default. Tonal layering and hairline borders establish most structure; small ambient shadows confirm a selected filter or lift an interactive media card, while medium and large shadows are reserved for floating menus, popovers, sheets, and other overlays. Backdrop blur belongs only to sticky translucent headers and modal backdrops.

### Shadow Vocabulary

- **Ambient XS** (`0 1px 2px 0 rgb(0 0 0 / 0.05)`): Search fields, filter containers, and quiet card lift.
- **Interactive Small** (`0 1px 3px 0 rgb(0 0 0 / 0.10), 0 1px 2px -1px rgb(0 0 0 / 0.10)`): Hovered media and selected segmented controls.
- **Floating Medium** (`0 4px 6px -1px rgb(0 0 0 / 0.10), 0 2px 4px -2px rgb(0 0 0 / 0.10)`): Select menus, popovers, and media overlays.
- **Overlay Large** (`0 10px 15px -3px rgb(0 0 0 / 0.10), 0 4px 6px -4px rgb(0 0 0 / 0.10)`): Sheets and high-priority floating layers.

**The Flat-at-Rest Rule.** A resting surface earns separation through tone and a hairline first. Use shadow when state or layering requires a spatial explanation.

## Shapes

X Media uses gently rounded rectangles, not capsules, as its dominant silhouette. Compact controls resolve near 9-11px radii, cards and identity marks near 16px, and badges or progress tracks may become fully rounded when their small height makes the pill shape functional. Borders are one-pixel, low contrast, and usually continuous; dashed borders are reserved for empty states. Media clips to the card silhouette and avatar imagery remains circular.

**The Rounded, Not Puffy Rule.** Corners should feel approachable but compact. Do not pair large radii with oversized padding or soft candy-like controls.

## Components

### Buttons

- **Shape:** Compact rounded rectangle (11px nominal radius), usually 32px high; 44px is reserved for prominent entry actions.
- **Primary:** Deep Signal Blue with white ink in light mode; Live Signal Blue with dark navy ink in dark mode. Default padding is compact, with text and optional 16px icons aligned on a tight gap.
- **Hover / Focus:** Reduce primary fill intensity on hover; use a visible three-pixel translucent focus ring plus focus border. A one-pixel active translation supplies tactile feedback.
- **Secondary / Ghost / Tertiary:** Outlines sit on the current canvas and gain Quiet Fill on hover. Ghost actions begin transparent. Link actions use the primary color and underline only on hover.

### Chips

- **Style:** Filter chips live inside a Quiet Fill rounded track, use small icons and tabular counts, and stay horizontally scrollable when space is constrained.
- **State:** Unselected chips are muted and flat. The selected chip uses the canvas surface, primary ink, and Ambient XS elevation. Status badges use fully rounded ends and semantic color only when the status needs it.

### Cards / Containers

- **Corner Style:** Gently rounded cards (16px nominal radius) and compact containers (11px).
- **Background:** Paper Surface in light mode and Charcoal Surface in dark mode; the application canvas remains visible between cards.
- **Shadow Strategy:** Flat at rest with a hairline. Interactive media cards gain Interactive Small elevation on hover.
- **Border:** One-pixel low-contrast outline, implemented as a border or foreground ring.
- **Internal Padding:** 12px for compact cards and rows; 16px for metrics and standard panels; larger empty and loading states may use 24-40px.

### Inputs / Fields

- **Style:** Transparent or surface-backed interior, one-pixel input border, compact radius, and muted placeholder. Search and username entry may group a prefix or icon inside the shared outline.
- **Focus:** Shift the border to Live Signal Blue and add a three-pixel translucent ring. Keep the input's geometry stable.
- **Error / Disabled:** Errors use Operational Red for border, copy, and a translucent ring. Disabled fields retain their layout, mute their fill, and lower opacity.

### Navigation

Navigation uses a 64px structural rail or header, one-pixel separators, compact semibold labels, and muted inactive items. Active destinations gain Quiet Fill and primary ink, sometimes with Ambient XS elevation. The X Media identity mark is a rounded blue-tinted tile with a play icon and a restrained green radial glint; desktop presents the wordmark and context line, while narrow headers may show the mark alone.

The shared media header retains the X, Tweets, Reddit, and Folders text destinations at every width, alongside Dashboard and the theme toggle. Below 768px the wordmark and context line disappear; below 640px the identity mark and navigation spacing tighten and Dashboard becomes a labeled icon. All destinations and both utility controls remain reachable at 320px.

The Tweets page presents free public collection and an expandable archive import form in the existing compact panel. Keep history limits visible alongside the account's saved count. Connection failures give a recovery action and preserve visible results. At mobile widths, tweet text and editable filter fields use at least 16px type; the file picker and collection actions wrap within the page gutters.

### Media Archive Card

The media card is the signature visual bridge between data and source material. A 4:3 preview fills the top of a bordered card, the asset type sits in a small black translucent label over the image, and post text plus date remain compact below. Hover scales the image only to 1.02 over 300ms and raises the card by one shadow step; the treatment should feel inspectable, not cinematic.

### Overlays

Dialogs and select menus use the current popover surface, a foreground hairline ring, and medium elevation. Detail sheets attach to a viewport edge, cap their desktop width, and divide fixed headers from independently scrollable content. Entry and exit transitions are short (100-200ms), use opacity with slight translation or scale, and collapse to effectively no motion under reduced-motion preferences.

## Do's and Don'ts

### Do:

- **Do** preserve warm neutral canvases and use distinct surface tones in both light and dark themes.
- **Do** reserve blue for actions, focus, progress, selected signal, and intentional data emphasis.
- **Do** use compact spacing, tabular numerals, and muted metadata to make dense information easy to scan.
- **Do** let source media or charts carry visual interest while keeping surrounding chrome restrained.
- **Do** reflow controls and grids at narrow widths while preserving complete functionality and honest state language.
- **Do** honor reduced motion, forced colors, keyboard focus, and a minimum 320px viewport.

### Don't:

- **Don't** turn X Media into a generic social dashboard with oversized social metrics, feed-like chrome, or decorative engagement color.
- **Don't** spread blue across large passive surfaces or use semantic accent colors without data or state meaning.
- **Don't** use heavy shadows, glass effects, or blur on ordinary resting cards.
- **Don't** introduce a display font, exaggerated type scale, or loose editorial spacing into the operational workspace.
- **Don't** hide search, filters, completeness, billing, demo, or partial-result context to make a surface look cleaner.
- **Don't** add oversized pills, ornamental gradients, or animation that competes with scanning and inspection.
