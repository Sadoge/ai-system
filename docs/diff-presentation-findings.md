# Diff presentation findings

## Styling ground truth

The web theme is defined in `apps/web/src/app/globals.css`. Diff styling uses only its existing custom properties:

- Addition mint: `color-mix(in hsl, var(--color-cue-bright) 68%, var(--color-hold-bright))`. The theme has no standalone mint property, so this existing-token mix is the shared addition ink; its 10% transparent mix is the row wash.
- Deletion: `--color-mark` for the 10% row wash and `--color-mark-bright` for small marker text.
- Hunk headers and focus: `--color-cue-bright`, with `--color-ground` beneath hunk text.
- Rules and gutters: `--color-rule`, `--color-rule-strong`, `--color-ink-label`, and `--color-ink-faint`.
- Code: `--font-mono` with tabular figures.

The existing small breakpoint begins at 640px, so the diff metadata stack applies below it.

## CSS class contract

- File shell: `.diff-file`
- Sticky header outside the horizontal scroller: `.diff-file-header`
- File header layout and control: `.diff-file-row`, `.diff-file-disclosure`, `.diff-file-path`, `.diff-file-meta`
- Horizontal scroll container and code block: `.diff-scroll`, `.diff-code`
- Code row and cells: `.diff-row`, `.diff-line-number`, `.diff-line-marker`, `.diff-line-content`
- Row states: `.diff-row-addition`, `.diff-row-deletion`, `.diff-row-hunk`

The required nesting is `.diff-file > .diff-file-header + .diff-scroll`; `.diff-file-header` must never be placed inside `.diff-scroll`, otherwise the sticky header will move with horizontally scrolled code.
