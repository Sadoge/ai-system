---
name: ai-system
description: Deterministic orchestration, read as a score — parallel voices in strict time on a diazo blueprint ground.
colors:
  ground: "#101a33"
  ground-raised: "#17233f"
  ground-band: "#1c2b4d"
  rule: "#2f4470"
  rule-strong: "#46608f"
  ink: "#ece4d6"
  ink-secondary: "#c3cddf"
  ink-muted: "#93a2c0"
  ink-label: "#7f90b2"
  ink-faint: "#7286ad"
  mark: "#e2452f"
  mark-bright: "#f27a63"
  cue: "#4b8fd6"
  cue-bright: "#8dbdec"
  hold: "#d99a2b"
  hold-bright: "#f0bf6a"
typography:
  wordmark:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace"
    fontSize: "1.25rem"
    fontWeight: 700
    lineHeight: 1.4
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 400
    lineHeight: 1.375
  title:
    fontFamily: "ui-serif, Georgia, Cambria, 'Times New Roman', serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
    fontStyle: "italic"
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.625
  annotation:
    fontFamily: "ui-serif, Georgia, Cambria, 'Times New Roman', serif"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.5
    fontStyle: "italic"
  readout:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.5
    fontFeature: "tabular-nums"
  micro:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace"
    fontSize: "0.6875rem"
    fontWeight: 400
    lineHeight: 1.2
    fontFeature: "tabular-nums"
rounded:
  none: "0px"
spacing:
  hair: "2px"
  xs: "4px"
  sm: "6px"
  md: "12px"
  lg: "16px"
  xl: "20px"
  system: "40px"
components:
  button-mark:
    backgroundColor: "transparent"
    textColor: "{colors.mark-bright}"
    typography: "{typography.readout}"
    rounded: "{rounded.none}"
    padding: "6px 12px"
  button-mark-hover:
    backgroundColor: "{colors.mark}"
    textColor: "{colors.ground}"
  button-quiet:
    backgroundColor: "transparent"
    textColor: "{colors.ink-muted}"
    typography: "{typography.readout}"
    rounded: "{rounded.none}"
    padding: "6px 12px"
  button-quiet-hover:
    textColor: "{colors.mark-bright}"
  input-rule:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.none}"
    padding: "6px 4px"
  rehearsal-mark:
    backgroundColor: "transparent"
    textColor: "{colors.ink-label}"
    typography: "{typography.micro}"
    rounded: "{rounded.none}"
    padding: "2px 6px"
  caesura:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "16px 16px"
  nav-movement:
    backgroundColor: "transparent"
    textColor: "{colors.ink-label}"
    typography: "{typography.readout}"
    rounded: "{rounded.none}"
    padding: "2px 0"
  nav-movement-active:
    textColor: "{colors.ink}"
---

# Design System: ai-system

## Overview

**Creative North Star: "The Conductor's Score"**

FORM: Conductor's Score; candidate 3 of 7; seed `3e3865ce`. The direction contract is emitted into the built markup in `layout.tsx` so any render can be audited against the decision that produced it; this file records the same roll on disk.

A run is a score. Parallel voices proceed in strict time across a diazo blueprint ground, ruled with engraved bone hairlines, and a human reads them and decides when the music proceeds. The world is drafting-table, not dashboard: structure is carried by ruling and position rather than by boxes, and state is carried by notation — a notehead, a fermata, a barline — rather than by a filled pill. The confirmed anti-reference is the dark dashboard of status pills; nothing in this system fills a rounded chip with a state colour to say "running".

Density is high and unapologetic. The reading is horizontal: stage barlines cross every voice left to right, task voices are placed by dependency depth, and ties bind a dependent to what it waited for. The one place the system stops is the caesura — a full-width vermilion hold carrying the control that releases it. Colour is scarce and load-bearing: the blueprint and bone do all structural work, and the three annotation hues (vermilion, cobalt, ochre) appear only where a state demands them.

The annotation voice is a separate register. Italic serif is the conductor writing on the page — labels, asides, empty-state sentences, the explanations under a chart — while monospace carries every machine-produced value and system sans carries human prose. No web fonts are loaded at all; the type comes from the reader's own machine, which suits a tool that runs beside the terminal.

**Key Characteristics:**
- Diazo blueprint ground (`#101a33`) with engraved bone ink; near-monochrome until state speaks
- Three-line staves, stage barlines, rehearsal marks and ties as the structural vocabulary
- Zero border radius and zero shadows anywhere in the system
- Three type registers: mono for machine values, system sans for prose, italic serif for annotation
- Vermilion is reserved absolutely for "a human must decide" and "this failed"
- No web fonts; no filled status pills; no decorative colour

## Colors

A near-monochrome blueprint: two families of structure (ground and rule) plus a five-step bone ink ramp, with three annotation hues that are permitted to appear only as state.

### Primary
- **Conductor's Vermilion** (`{colors.mark}`): The conductor's own pencil. It marks exactly two things — a decision only a human can make, and something that failed. It draws the current-position barline, the caesura's edges and hatching, the active movement's margin tick in the nav, the error rule beside a failed run, and the affirmative button's stroke. It is never used to decorate and never used for quantity.
- **Vermilion Bright** (`{colors.mark-bright}`): The same pencil at text weight. Every vermilion *word* — status text, gate names, error text, the "now" annotation — uses this step, for contrast reasons recorded below.

### Secondary
- **Cobalt Cue** (`{colors.cue}` / `{colors.cue-bright}`): The cue: in progress, sounding, live. The bright step carries running status text, links, artifact kinds, and the pulsing notehead on the current stage; the base step is the focus/active stroke on inputs and link underlines.

### Tertiary
- **Ochre Hold** (`{colors.hold}` / `{colors.hold-bright}`): Held, paused, repeated. The bright step carries paused voices and the italic *da capo* mark on a fix iteration.

### Neutral
- **Diazo Ground** (`{colors.ground}`): The blueprint sheet. The page background, and also the knockout colour that lets content clear the staff ruling.
- **Ground Raised** (`{colors.ground-raised}`): The single hover wash on list rows. The only tonal step used for interaction.
- **Ground Band** (`{colors.ground-band}`): The unfilled track behind a dynamic (bar) in analytics.
- **Rule** (`{colors.rule}`): The engraved hairline. Staff lines, list dividers, section rules, table row rules. It does nearly all structural work in the system.
- **Rule Strong** (`{colors.rule-strong}`): The heavier engraving: stage barlines, the system brace, table header rules, input underlines, ties.
- **Bone Ink** (`{colors.ink}`): Primary reading text — headings, part names, values that matter.
- **Bone Secondary** (`{colors.ink-secondary}`): Table bodies, completed voices, system titles.
- **Bone Muted** (`{colors.ink-muted}`): Supporting prose, chart labels, quantity bars, completed status text.
- **Bone Label** (`{colors.ink-label}`): Italic annotation labels, rehearsal marks, stage names, the engraved select chevron.
- **Bone Faint** (`{colors.ink-faint}`): Timestamps, attempt ratios, inert and not-yet-sounding voices.

### Named Rules

**The Conductor's Pencil Rule.** Vermilion means a human must decide, or something failed. Nothing else in the system may use it — not headings, not emphasis, not brand furniture. Cobalt means in progress; ochre means held. If a colour on the screen does not encode state, it is wrong.

**The 4.23 Rule.** `{colors.mark}` measures 4.23:1 on the blueprint ground, which is under the bar for 12–14px text. It is therefore permitted only where it is *not* text — barlines, rules, borders, the caesura edge and hatch, icon strokes at 16px+. Small vermilion text always takes `{colors.mark-bright}`.

**The Bone Quantity Rule.** Quantities are drawn in bone, never in a state colour. Analytics bars, counts, costs, rates and finding tallies use `{colors.ink-muted}` or `{colors.ink-secondary}`. A bar chart is not a state, and colouring one vermilion would spend the pencil on arithmetic.

## Typography

**Body Font:** system sans stack (`-apple-system`, `BlinkMacSystemFont`, `Segoe UI`, Roboto, Arial)
**Label/Mono Font:** system mono stack (`ui-monospace`, `SFMono-Regular`, Menlo, Monaco, Consolas)
**Annotation Font:** system serif stack (`ui-serif`, Georgia, Cambria, Times New Roman) — always italic

**Character:** Three registers with three jobs, and the reader can tell which is speaking without reading a word. Monospace is the machine reporting; sans is a person writing; italic serif is the conductor annotating the page in the margin. Nothing is loaded over the network — the whole ramp resolves against the reader's own installed faces.

### Hierarchy
- **Wordmark** (mono, 700, 1.25rem, tight tracking): The programme head only — the product name in the header. The single bold in the system.
- **Headline** (sans, 400, 1.25rem, 1.375): The run's ticket title. The largest human text on any surface; there is no larger step.
- **Title** (italic serif, 400, 1rem): A system's title beside its rehearsal mark.
- **Body** (sans, 400, 0.875rem, 1.625 for prose): Part names, finding titles and details, list content.
- **Annotation** (italic serif, 400, 0.75–0.875rem, `{colors.ink-label}`): Field labels, table headers, empty states, explanatory paragraphs under a chart, "now", "after …", "beat 3".
- **Readout** (mono, 400, 0.75rem, tabular): Machine-produced values — statuses, costs, timestamps, attempt ratios, nav movements.
- **Micro** (mono, 400, 0.6875rem, 1.2, tabular): Engraver's small type — stage labels under noteheads, rehearsal marks, right-margin task metadata. It sits *under* the content it labels and must never compete with it.

### Named Rules

**The Three Voices Rule.** Machine-produced values are monospace with tabular figures so costs, counts and attempt ratios align down a column. Human prose is system sans. Annotation is italic serif. A value never gets the serif; a sentence never gets the mono.

**The Unloaded Type Rule.** No web font is loaded anywhere. The ramp is built from `-apple-system`, `ui-monospace` and `ui-serif` stacks; a new surface that adds a font file breaks the system.

**The Small Type Floor Rule.** 0.6875rem is the floor and it is reserved for labels beneath their content. Nothing a reader must act on is set at micro.

## Layout

One centred column, max width 72rem (`max-w-6xl`), padded 20px at phone width and 32px from the `sm` breakpoint, 28px top. There is no sidebar and no card grid: the page is a stack of *systems*, each a `<section>` with 40px of space beneath it, opened by a rehearsal mark and a title whose hairline rule runs to the right edge to carry the eye across.

Vertical rhythm is engraved rather than boxed: rows are separated by 1px `{colors.rule}` dividers, not gaps and borders. Spacing runs on a 2 / 4 / 6 / 12 / 16 / 20 / 40px rhythm — 12px is the standard inline gap between marks and labels, 20px between stacked caesuras, 40px between systems.

The signature layout is positional. In the run system, the horizontal axis is real: stage columns are laid across the full width from the run's own stage list, and task voices are placed at the horizontal position of their dependency depth, so voices at the same depth align vertically because they genuinely run in parallel. Rows are a fixed 46px per voice with a 62px stage row above. Nothing is positioned by data the API does not report — per-task duration is deliberately not drawn.

Responsive behaviour follows the product's one committed mobile surface. Gate approval must work on a phone: the caesura, its comment field and its two buttons wrap and remain full-size at every width. Every other surface is desktop-first and only guaranteed not to break. The engraved run system is desktop-only (`hidden sm:block`) and is replaced below `sm` by a compact ruled reading of the same facts in text — which doubles as the accessible equivalent at every width, since the engraved system is `aria-hidden`. Wide tables scroll horizontally inside their system rather than reflowing.

## Elevation & Depth

There are no shadows in this system. Nothing is lifted, nothing floats, and there is no elevation ramp. Depth is entirely a matter of ruling and ink weight: a heavier rule reads as more structural than a hairline, and the five-step bone ramp puts primary text forward and timestamps back. The only surface-tone shift in the whole build is the hover wash on a list row.

The one `box-shadow` in the stylesheet is not depth. `.stave-clear` paints `0 0 0 0.35rem var(--color-ground)` — a zero-offset, zero-blur ring of the ground colour that knocks a halo out of the staff ruling so type and noteheads sit cleanly on the stave instead of being struck through. It is a knockout, and it must stay zero-offset and zero-blur.

### Named Rules

**The No Shadow Rule.** No offset, no blur, no glow, anywhere. If a surface needs to be distinguished, rule it or shift its ink weight. The only permitted `box-shadow` is the `.stave-clear` knockout, and only at `0 0 0`.

## Shapes

The system is square. There is no border radius: the sole radius token in the theme is a 1px value that nothing consumes, and every button, input, mark box and caesura in the build is a hard rectangle. Corners are drafting corners.

Form language is line, not container. Structure comes from strokes: 1px hairlines for staves and dividers, 1px–2px barlines, a 2px stroke for the affirmative button, a 1px box for a rehearsal mark, a single bottom rule for an input, a left rule for a finding or an error. Filled shapes are rare and always meaningful — a filled notehead, a filled quantity bar, a filled button on hover.

Icons are drawn, never typed: noteheads (11×11 ellipse rotated -20°, filled / hollow / cross / rest bar) and the fermata (18×11 arc with a dot) are inline SVG on `currentColor`. The select chevron is an authored inline SVG replacing the OS control so no un-authored widget sits inside a committed form.

## Components

### Buttons
- **Shape:** Hard rectangle (0 radius), 6px × 12px padding, mono at 0.875rem.
- **The Mark (primary):** The affirmative decision is the conductor's stroke — a 2px vermilion border on transparent ground with `{colors.mark-bright}` text. Its weight comes from the stroke, not a fill.
- **Hover:** Committing fills the stroke in: background goes to `{colors.mark}`, text to the ground colour.
- **The Other Decision (quiet):** A 1px `{colors.rule-strong}` border with `{colors.ink-muted}` text; on hover the border turns vermilion and the text goes bright. Quiet at rest, it reaches for the pencil when you approach it.
- **Focus:** A 2px `{colors.cue-bright}` outline offset 2px, on every interactive element without exception.

### Inputs / Fields
- **Style:** No box. A single bottom rule in `{colors.rule-strong}` on transparent ground, mono at 0.875rem, placeholder in `{colors.ink-faint}`.
- **Focus:** The underline shifts to cobalt and the cobalt focus ring appears.
- **Select:** Same underline, plus an engraved chevron drawn in `{colors.ink-label}` at the right edge with the native appearance removed.
- **Label:** Italic serif annotation above the field, never inside it.

### Navigation
Movements, not tabs. A single wrapped row of mono 0.75rem links with wide tracking under the programme head, separated from it by a hairline. Inactive is `{colors.ink-label}`, hover lifts to `{colors.ink-secondary}`, and the current movement goes full bone with a 2px vermilion tick in the left margin — a conductor's mark against the movement being read, not a filled tab. The deepest matching route wins, so a nested route marks only itself.

### System (section)
The page's unit. A rehearsal mark (boxed mono micro letter, 1px `currentColor` border) opens it, an italic serif title follows, a hairline rule fills the remaining width, and an optional mono tabular count sits at the far right. 40px below it, the next system begins.

### Caesura (signature)
Where the score holds for a human, and the only element permitted to interrupt the system. A full-width band with 1px vermilion rules top and bottom and a -58° repeating hatch of vermilion at 22% over the ground, 16px padding. It carries the fermata, the gate name, an optional link to the artifact under review, a comment field, and the two decision buttons. It is never used for anything but a decision that is genuinely blocking.

### Stave / Run System (signature)
A voice is read along a stave: three hairlines, not five — five reads as ornament at UI scale, three reads as structure — painted behind the row by a repeating gradient and masked to fade over the outer 3rem so a voice enters and leaves the stave rather than being boxed by it. Content rides above on a `.stave-clear` knockout.

The run system stacks the run's own voice over one stave per task, all crossed by the same stage barlines, which is what makes it a single system rather than a set of rows. A hairline brace at the left binds the task voices. State is a notehead: filled = played, hollow = sounding, cross = dead, a bar = resting; anything waiting on a human takes a fermata instead. The current stage's notehead pulses (1.9s ease-in-out, opacity 1→0.45), and that animation is removed entirely under `prefers-reduced-motion`. Dependents are joined to what they waited for by a quadratic tie in `{colors.rule-strong}` with a non-scaling stroke. Barlines are 1px `{colors.rule-strong}`; the current position is a 2px vermilion barline.

### Dynamics (quantity bars)
A magnitude read along the stave: a mono label at fixed width, a 10px `{colors.ground-band}` track filled in `{colors.ink-muted}`, and a right-aligned tabular value. Bone only, with a 1.5% minimum fill so a nonzero value never disappears.

### Tables
Ruled, never striped and never boxed. A `{colors.rule-strong}` header rule under italic serif lowercase headers, `{colors.rule}` between rows, mono tabular numerics right-aligned, and horizontal scroll inside the system when the columns exceed the column width.

## Do's and Don'ts

### Do:
- **Do** spend vermilion only on "a human must decide" and "this failed"; cobalt on in-progress; ochre on held.
- **Do** use `{colors.mark-bright}` for any vermilion word at 12–14px, and reserve `{colors.mark}` for rules, barlines, borders and the caesura edge (The 4.23 Rule).
- **Do** set every machine-produced value in mono with `font-variant-numeric: tabular-nums` so columns align.
- **Do** draw quantities in bone (The Bone Quantity Rule).
- **Do** carry structure with hairline rules and position rather than with cards, boxes or fills.
- **Do** open every page section with a rehearsal mark, an italic serif title and a rule that runs to the right edge.
- **Do** give the engraved run system a text equivalent that is visible on phones and readable by assistive tech, and mark the graphic `aria-hidden`.
- **Do** keep gate approval fully usable at phone width — it is the one committed mobile surface.
- **Do** put a 2px cobalt focus ring, offset 2px, on every interactive element.
- **Do** kill the live pulse under `prefers-reduced-motion`.

### Don't:
- **Don't** use a filled status pill or a rounded state chip; state is a notehead, a fermata or a barline.
- **Don't** add a border radius. The system is square everywhere.
- **Don't** add a shadow. The only `box-shadow` permitted is the zero-offset `.stave-clear` knockout, and it is not depth.
- **Don't** load a web font, or introduce a fourth type register beyond mono, sans and italic serif.
- **Don't** draw five staff lines. Three.
- **Don't** let a state colour touch a chart, a count, a total or a rate.
- **Don't** ship an un-authored native control surface (an OS select chevron) inside a committed form.
- **Don't** interrupt a system with anything but a caesura, and only for a decision that is genuinely blocking.
- **Don't** plot anything the API does not report — per-task duration is not drawn because there are no per-task timings.
- **Don't** set actionable content at the 0.6875rem micro step.
