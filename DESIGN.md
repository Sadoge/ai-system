---
name: ai-system
description: A control room for deterministic AI agent runs — dark, dense, and instrument-legible.
colors:
  instrument-black: "oklch(14.1% 0.005 285.823)"
  instrument-surface: "oklch(21% 0.006 285.885)"
  instrument-line: "oklch(27.4% 0.006 286.033)"
  instrument-line-strong: "oklch(37% 0.013 285.805)"
  readout-primary: "oklch(96.7% 0.001 286.375)"
  readout-secondary: "oklch(87.1% 0.006 286.286)"
  readout-muted: "oklch(70.5% 0.015 286.067)"
  readout-label: "oklch(55.2% 0.016 285.938)"
  readout-faint: "oklch(44.2% 0.017 285.786)"
  signal-emerald: "oklch(76.5% 0.177 163.223)"
  signal-emerald-action: "oklch(50.8% 0.118 165.612)"
  signal-emerald-action-hover: "oklch(59.6% 0.145 163.225)"
  signal-emerald-field: "oklch(37.8% 0.077 168.94)"
  signal-emerald-inline: "oklch(26.2% 0.051 172.552)"
  fault-red: "oklch(80.8% 0.114 19.571)"
  fault-red-bright: "oklch(70.4% 0.191 22.216)"
  fault-red-action: "oklch(44.4% 0.177 26.899)"
  fault-red-action-hover: "oklch(50.5% 0.213 27.518)"
  fault-red-field: "oklch(39.6% 0.141 25.723)"
  fault-red-inline: "oklch(25.8% 0.092 26.042)"
  standby-sky: "oklch(82.8% 0.111 230.318)"
  standby-sky-bright: "oklch(90.1% 0.058 230.902)"
  standby-sky-line: "oklch(44.3% 0.11 240.79)"
  standby-sky-field: "oklch(29.3% 0.066 243.157)"
  hold-amber: "oklch(87.9% 0.169 91.605)"
  hold-amber-field: "oklch(41.4% 0.112 45.904)"
  hold-amber-inline: "oklch(27.9% 0.077 45.635)"
  running-indigo: "oklch(78.5% 0.115 274.713)"
  running-indigo-field: "oklch(35.9% 0.144 278.697)"
  running-indigo-inline: "oklch(25.7% 0.09 281.288)"
typography:
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', 'Noto Sans', Arial, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.556
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', 'Noto Sans', Arial, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.429
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', 'Noto Sans', Arial, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 600
    lineHeight: 1.429
    letterSpacing: "0.025em"
  readout:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.333
    fontFeature: "tnum"
  wordmark:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace"
    fontSize: "1.125rem"
    fontWeight: 700
    lineHeight: 1.556
rounded:
  default: "0.25rem"
spacing:
  hairline: "0.125rem"
  xs: "0.25rem"
  sm: "0.5rem"
  md: "0.75rem"
  lg: "1rem"
  xl: "1.5rem"
  section: "2rem"
components:
  button-primary:
    backgroundColor: "{colors.signal-emerald-action}"
    textColor: "#ffffff"
    rounded: "{rounded.default}"
    padding: "0.375rem 0.75rem"
    typography: "{typography.body}"
  button-primary-hover:
    backgroundColor: "{colors.signal-emerald-action-hover}"
  button-danger:
    backgroundColor: "{colors.fault-red-action}"
    textColor: "#ffffff"
    rounded: "{rounded.default}"
    padding: "0.375rem 0.75rem"
    typography: "{typography.body}"
  button-danger-hover:
    backgroundColor: "{colors.fault-red-action-hover}"
  input-text:
    backgroundColor: "{colors.instrument-surface}"
    textColor: "{colors.readout-primary}"
    rounded: "{rounded.default}"
    padding: "0.375rem 0.75rem"
    typography: "{typography.body}"
  card-panel:
    backgroundColor: "{colors.instrument-black}"
    textColor: "{colors.readout-primary}"
    rounded: "{rounded.default}"
    padding: "1rem"
  card-gate:
    backgroundColor: "{colors.standby-sky-field}"
    textColor: "{colors.standby-sky-bright}"
    rounded: "{rounded.default}"
    padding: "1rem"
  badge-status:
    backgroundColor: "{colors.signal-emerald-field}"
    textColor: "{colors.signal-emerald}"
    rounded: "{rounded.default}"
    padding: "0.125rem 0.5rem"
    typography: "{typography.readout}"
  chip-stage:
    backgroundColor: "{colors.signal-emerald-inline}"
    textColor: "{colors.signal-emerald}"
    rounded: "{rounded.default}"
    padding: "0.25rem 0.5rem"
    typography: "{typography.readout}"
  row-list:
    backgroundColor: "{colors.instrument-black}"
    textColor: "{colors.readout-primary}"
    padding: "0.75rem 1rem"
    typography: "{typography.body}"
  row-list-hover:
    backgroundColor: "{colors.instrument-surface}"
  nav-link:
    textColor: "{colors.readout-muted}"
    typography: "{typography.body}"
  nav-link-hover:
    textColor: "{colors.readout-primary}"
---

# Design System: ai-system

## Overview

**Creative North Star: "The Control Room"**

This is a calm, dark room where one engineer watches a system they started and steps in at
defined moments. Nothing in it competes for attention, because the thing worth attending to is
the run: which stage it reached, what the reviewer found, whether it is waiting on a human. The
interface is the glass in front of the instruments, not the instruments themselves. Its job is
to disappear until a state changes, then make that change unmissable.

The material vocabulary is deliberately narrow. One near-black ground, one lifted surface, one
hairline rule, one corner radius, and a type system with exactly two voices — a system sans for
what humans wrote, and a monospace for what the machine produced. Density is high and
deliberate: text is small, rows are tight, and a whole run's state fits in one screen without
scrolling. That density is what makes the room readable at a glance, the same way a control
panel is readable because everything is on it at once.

Color is the only loud thing here, and it is loud exactly once per element. Every hue in this
system means a state — completed, failed, awaiting a human, running, paused — and appears
nowhere else. The result is that a screen with no color is a screen with nothing to worry
about, and a single emerald or sky pixel is genuinely informative. The rejected alternative is
the ambient product-UI look: gradient headers, tinted cards, decorative accent borders, brand
color sprayed across surfaces that carry no state. That look would destroy the one signal this
interface actually has.

**Key Characteristics:**
- Near-black ground (`instrument-black`) with a single lifted surface tone; no third layer
- Hairline borders as the only structural device — zero shadows anywhere in the system
- One radius (4px) on every element, without exception
- Monospace for machine-produced values, system sans for human-written prose
- Color reserved entirely for state; a monochrome screen is a healthy screen
- Small type (12–14px dominant), tight rows, high information density
- Dark-only; there is no light theme and none is planned

## Colors

A near-monochrome instrument face in cool graphite, carrying five saturated state signals that
never appear decoratively.

### Primary

- **Signal Emerald** (`signal-emerald`): The product's one identity color and its affirmative
  state. It sets the `ai-system` wordmark, artifact and rule kind labels, cost figures, and the
  `completed` state on runs, stages, and tasks. On interactive controls it drops to
  `signal-emerald-action` so white label text stays legible against it — the bright tone is for
  reading, the deep tone is for pressing.

### Secondary

- **Standby Sky** (`standby-sky`): The system is waiting on a human. It marks every
  `awaiting_*` run status and the gate name itself, and `standby-sky-field` with a
  `standby-sky-line` border is the one place a surface is tinted rather than neutral — the
  pending-gate card on run detail. This is the only tinted panel in the system, and it earns
  that exception because it is the only moment the interface is blocking on the person reading
  it.

### Tertiary

- **Fault Red** (`fault-red`): Something failed. Failed runs, failed stages and tasks, blocker
  and major findings, run-level error banners, and the reject control.
- **Hold Amber** (`hold-amber`): Paused, or flagged for attention without failure. Paused runs,
  fix-iteration task badges, and truncated sections in the brain inspector.
- **Running Indigo** (`running-indigo`): Work in progress. Running tasks and any run status the
  system does not otherwise classify.

### Neutral

- **Instrument Black** (`instrument-black`): The page ground, and the default background of
  every panel and row. Panels are distinguished from the page by their border, not their fill.
- **Instrument Surface** (`instrument-surface`): The one lifted tone — input fields, hovered
  rows, inert chips, and the track behind analytics bars.
- **Instrument Line** (`instrument-line`): The hairline that does all structural work — panel
  borders, list dividers, the header rule. `instrument-line-strong` is reserved for input
  borders, which need to read as editable.
- **Readout Primary** (`readout-primary`) through **Readout Faint** (`readout-faint`): A
  five-step text ramp, used strictly by importance — primary for values that matter, secondary
  and muted for supporting prose, label for section headings and field labels, faint for
  timestamps and counters that should recede almost entirely.

### Named Rules

**The State-Only Rule.** Every hue in this system encodes a state. If a colored pixel is not
telling you the status of a run, stage, task, gate, or finding — or marking the one affirmative
action on the screen — it is a bug. Color is never applied for hierarchy, emphasis, branding, or
decoration.

**The Quiet Screen Rule.** A screen with no color on it means nothing needs attention. Preserve
that: never introduce a colored element that is always present regardless of state, because it
raises the floor and destroys the signal.

**The Two Depths Rule.** State color appears at two intensities and they are not
interchangeable. Badges that identify a whole record use the `-field` tone behind the bright
tone (`signal-emerald-field` + `signal-emerald`). Inline chips inside a record — stage pills,
task status — use the darker `-inline` tone. Depth encodes scope, so a stage never shouts as
loud as the run that contains it.

## Typography

**Body Font:** system sans (`-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, …`)
**Label/Mono Font:** system monospace (`ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, …`)

**Character:** Two voices with a strict division of labor and no third. The sans is the
platform's own — unstyled, invisible, chosen so nothing about the typeface asks to be noticed.
The mono is where the personality lives: it makes machine output look like machine output and
gives the whole interface its terminal-adjacent seriousness. There is no display face and no
web font; the system loads no typography at all.

### Hierarchy

- **Wordmark** (mono, 700, 1.125rem): The `ai-system` mark in the header, in Signal Emerald.
  The only bold monospace in the system.
- **Title** (sans, 600, 1.125rem): Run titles on run detail. The largest human-written text
  anywhere.
- **Label** (sans, 600, 0.875rem, `0.025em`, uppercase, Readout Label): Section headings. Their
  smallness and muted tone are the point — they organize without competing with content.
- **Body** (sans, 400, 0.875rem): Ticket titles, finding details, knowledge content, prose.
- **Readout** (mono, 400, 0.75rem, tabular figures): Every machine-produced value — run and
  gate IDs, statuses, stage and pipeline names, executor kinds, costs, counts, attempt ratios,
  timestamps.

### Named Rules

**The Machine Truth Rule.** Monospace means the system produced this value. Run IDs, statuses,
stage names, pipeline and automation names, executor kinds, costs, counts, and attempt ratios
are always mono. Anything a human wrote — ticket titles, gate comments, finding descriptions,
knowledge entries — is always sans. Never mix the two to create emphasis; the split carries
meaning.

**The Tabular Figures Rule.** Every monospace readout sets `font-variant-numeric: tabular-nums`
so costs, counts, and attempt ratios align vertically down a column. A cost figure that jitters
between rows is unreadable at a glance, which defeats the entire point of the readout voice.

**The Small Type Rule.** 0.75rem and 0.875rem carry this interface; 1.125rem is the ceiling.
Density is a feature — a run's full state should fit one screen. Reach for hierarchy through
weight, color, and the sans/mono split before reaching for size.

## Layout

A single centered column, capped at 64rem (`max-w-5xl`) with 1.5rem gutters and 1.5rem of
vertical padding. Everything lives in that column — there is no sidebar, no full-bleed region,
and no secondary rail.

The page is a stack of labeled sections, each separated by 2rem, with its uppercase label
0.75rem above its content. Within a section, content is one of three shapes: a bordered list
whose rows are divided by hairlines (runs, artifacts), a stack of bordered cards separated by
1rem (gates, knowledge proposals), or a wrapped row of chips separated by 0.5rem (stages, brain
metadata).

Spacing is a 0.25rem scale used sparsely: 0.25rem inside chips, 0.5rem and 0.75rem between
related controls, 1rem inside cards and between them, 1.5rem for major breaks, 2rem between
sections. Rows are 0.5–0.75rem tall vertically — deliberately tight.

Alignment does structural work in lists. Rows are flex rows where the identifying badge leads,
the human-written title takes the remaining space and truncates, and machine readouts are
pushed right with `margin-left: auto` so metadata forms a right-aligned column down the list.

The header is a single horizontal rule of nav links above all content, wrapping when narrow.
Responsive behavior today is only what flex wrapping provides; per PRODUCT.md, **gate approval
must work on a phone**, so gate surfaces — the pending-gate card on run detail and the gates
queue — are the surfaces that need real mobile design. Their approve/reject controls currently
sit in a single unwrapped flex row with a flexing comment input, which is the specific thing to
fix.

### Named Rules

**The One Column Rule.** Every surface lives in the same 64rem centered column. No screen
introduces a sidebar or a wider container; a dense screen earns its room by tightening rows,
not by widening the page.

## Elevation & Depth

**This system has no shadows.** Not on cards, not on modals, not on hover, not on focus. Depth
is expressed entirely through a 1px hairline border in Instrument Line and a single lift from
Instrument Black to Instrument Surface. A panel is a panel because it is outlined, not because
it floats.

There are exactly two surface levels — the ground and the lifted tone — and no third is
permitted. Nesting is expressed by borders inside borders, which is why the radius stays
constant: nested outlines at differing radii read as misaligned.

### Named Rules

**The No-Shadow Rule.** `box-shadow` is prohibited system-wide, including on overlays and
focused elements. If an element needs to separate from its surroundings, it gets a border. If
it needs to advance, it gets the lifted surface tone.

**The Two-Surface Rule.** Instrument Black and Instrument Surface are the only two backgrounds
for neutral elements. A third neutral tone would blur the distinction between "at rest" and
"raised", which is the only depth signal the system has.

## Shapes

One radius: 4px, on everything. Buttons, inputs, cards, badges, chips, list containers, and the
analytics bar and its track all share it. There is no pill, no circle, no square-cornered
element, and no larger radius for larger surfaces.

The dominant silhouette is the outlined rectangle — a hairline box with tight internal padding,
repeated at three scales: the chip (0.125–0.25rem vertical padding), the row (0.5–0.75rem), and
the card (1rem). Bordered lists share one outer border with hairline dividers between rows
rather than giving each row its own box, so a list reads as one instrument rather than a stack
of separate ones.

Borders are always exactly 1px and always a full outline; there are no single-sided accent
borders, no left-edge status stripes, and no dashed or doubled rules.

### Named Rules

**The Single Radius Rule.** 4px on every corner in the system. A component that wants a
different radius is a component that wants to be from a different system.

## Components

### Buttons

- **Shape:** 4px radius, no border, 0.375rem × 0.75rem padding, 0.875rem semibold sans.
- **Primary:** Signal Emerald Action ground with white label. Used for the single affirmative
  action on a surface — Start, Approve, Search, Save.
- **Danger:** Fault Red Action ground with white label. Reject and destructive actions only.
- **Hover:** Both lighten by one step (`signal-emerald-action-hover`, `fault-red-action-hover`).
- **Focus:** Currently browser default. Any focus treatment added must be a ring or border
  shift, never a shadow.
- There is no secondary, ghost, or tertiary button. Non-primary actions are plain underlined
  links in Readout Muted.

### Inputs / Fields

- **Style:** Instrument Surface fill, 1px Instrument Line Strong border, 4px radius,
  0.375rem × 0.75rem padding, 0.875rem sans, Readout Primary text, Readout Label placeholder.
- **Labels:** 0.75rem sans in Readout Label, stacked 0.25rem above the field.
- **Focus:** Browser default today. Selects share the identical treatment — there is one field
  style for every input type.

### Cards / Containers

- **Corner Style:** 4px.
- **Background:** Instrument Black — the same as the page. The border alone defines the card.
- **Border:** 1px Instrument Line.
- **Shadow Strategy:** None. See Elevation & Depth.
- **Internal Padding:** 1rem.
- **Gate variant:** The one exception — Standby Sky Field fill with a Standby Sky Line border,
  used exclusively for a gate that is blocking on the reader.

### Badges and Chips

- **Status badge:** 4px radius, 0.125rem × 0.5rem padding, 0.75rem mono, state `-field`
  background with the bright state text. Identifies the state of a whole record.
- **Inline chip:** 0.25rem × 0.5rem padding, 0.75rem mono, state `-inline` background with the
  bright state text. Used for stages and task status inside a record.
- **Metadata chip:** Instrument Surface or a bare Instrument Line outline with Readout Muted
  mono text, for non-state facts like executor kind or brain counts.

### Lists and Rows

- **Bordered list:** One outer 1px Instrument Line box at 4px radius, rows separated by
  hairline dividers of the same color. Rows are 0.5–0.75rem × 1rem.
- **Row anatomy:** Leading status badge, flexing truncated human title, right-pushed mono
  metadata, faint timestamp last.
- **Hover:** Row background lifts to Instrument Surface on navigable rows only. Non-navigable
  rows have no hover state.
- **Empty state:** A single 0.875rem Readout Label sentence inside the list border that says
  what would appear here and how to make it appear — "No runs yet — start one above."

### Navigation

- **Style:** A single horizontal row of 0.875rem sans links in Readout Muted, 1rem apart, above
  a 1px Instrument Line rule, with the emerald mono wordmark at the left.
- **States:** Hover lifts to Readout Primary. There is currently no active-route treatment.
- **Mobile:** Wraps to multiple lines; no drawer or collapse.

### Progress Bar (signature)

The analytics bar is the system's one data-visualization primitive: a 0.75rem-tall Instrument
Surface track at 4px radius with a Signal Emerald Action fill, flanked by a fixed-width mono
label on the left and a fixed-width right-aligned mono value on the right. Its fixed side
columns are what let a stack of bars read as a chart rather than as a list.

## Do's and Don'ts

### Do:

- **Do** use 4px radius on every corner, with no exceptions for size or component type.
- **Do** express separation with a 1px Instrument Line border, and elevation with the
  Instrument Surface fill.
- **Do** set every machine-produced value in monospace with tabular figures, and everything a
  human wrote in the system sans.
- **Do** reserve color for state — run, stage, task, gate, finding — plus the single
  affirmative action on a surface.
- **Do** match state-color depth to scope: `-field` behind badges that label a whole record,
  `-inline` behind chips inside one.
- **Do** push machine metadata right with `margin-left: auto` so it forms an aligned column
  down a list.
- **Do** write empty states that name the thing and the action that creates it.
- **Do** give the gate card the Standby Sky tint — it is the one surface allowed to be tinted,
  because it is the one surface that blocks the reader.
- **Do** design gate approval to work at phone width; it is the one committed mobile surface.

### Don't:

- **Don't** add a `box-shadow` anywhere, including modals, hovers, and focus states.
- **Don't** introduce a third neutral surface tone above Instrument Black and Instrument
  Surface.
- **Don't** use color decoratively — no gradient headers, no tinted cards outside the gate
  card, no accent borders or left-edge status stripes, no brand color on surfaces that carry no
  state.
- **Don't** use monospace for emphasis on human-written text, or sans for a machine value.
- **Don't** exceed 1.125rem for any text, or widen the 64rem column.
- **Don't** give each row in a list its own border; one outer box with hairline dividers.
- **Don't** add a light theme or a theme toggle — this system is dark-only by design.
- **Don't** introduce a pill, circle, or squared corner, or a second radius value.
- **Don't** add a secondary or ghost button style; non-primary actions are underlined links.
