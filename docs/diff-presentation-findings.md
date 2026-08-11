# Diff presentation contracts

This is the single repository note for the structured diff shown on run and artifact pages.

## API and artifact shape

- The API uses the global `/api` prefix (`apps/api/src/main.ts`). Run detail is
  `GET /api/runs/:id`, and artifact detail is
  `GET /api/runs/:id/artifacts/:artifactId` (`apps/api/src/api.controller.ts`).
- Run detail embeds artifact summaries with `id`, `kind`, `contentHash`, and
  `createdAt` (`apps/api/src/api.service.ts`). It does not embed the artifact body.
- Artifact detail returns the full persisted artifact row, including `content`,
  or a 404. The controller does not wrap that row in `{ data: ... }`.
- `apiGet<T>` is an unchecked cast. The web reader therefore validates that a
  diff artifact has object content with a string `diff` field before rendering
  it (`apps/web/src/lib/diff-artifact.ts`). Legacy string content is also
  accepted by the artifact view and run-diff proxy.
- The artifact table permits inline `content` or a `storageRef`. The API does
  not currently hydrate object storage, so unavailable or malformed content is
  an explicit error state rather than an empty diff.
- Both workers persist `{ diff, baseBranch, branch }` for the `diff` kind
  (`apps/worker/src/mvp-stages.ts` and `apps/worker/src/team-stages.ts`). Task,
  stage, and iteration provenance stays optional.
- A run may contain multiple diff artifacts. The run page selects the latest
  summary in the API's ascending artifact order.

## Run-page composition and loading

- The run page fetches its primary `RunDetail` first. Full diff content is then
  loaded through the server-only `/run-diffs/:runId/:artifactId` proxy. The
  client loader is keyed by the immutable artifact ID, so live run refreshes do
  not repeatedly block on or fetch the same full blob.
- The run error appears before Code changes, preserving failure prominence.
- Artifact-fetch failures have their own rendered error branch and are never
  presented as no changes.
- The artifact detail route reuses `DiffPresentation`, so parsing and state
  behavior do not diverge between the two views.
- With four or more changed files, file bodies start collapsed and are not
  mounted. One to three files remain initially open for the small-review path.
- Each file initially renders at most 400 patch lines. Additional lines are
  available through an explicit reveal control.

## Parser and rendering behavior

- `apps/web/src/lib/unified-diff.ts` is the only unified-diff parser. It handles
  git headers, headerless unified patches, quoted and spaced paths, additions,
  deletions, renames, binary markers, mode metadata, no-newline markers, and
  trimmed empty context lines.
- Hunk-body parsing runs before `--- ` and `+++ ` file-marker parsing. This is
  required for changed source whose content itself begins with `-- ` or `++ `.
- Empty input and nonempty unparseable input are distinct parser states. Empty
  patches get the no-changes message; unparseable patches expose the stored raw
  content in a labeled, keyboard-focusable region.
- Long unchanged runs inside a hunk use `RevealLines`; changed lines and nearby
  context remain visible.
- Diff prefixes and line-number gutters are aria-hidden and non-selectable.
  Prefixes sit outside `code`, so copied selections contain source text rather
  than diff markers. Only additions and deletions carry a visible status word.
- File-toggle scrolling checks `prefers-reduced-motion` before requesting smooth
  scrolling.

## Shipped CSS class contract

The only diff stylesheet is the Code changes block in
`apps/web/src/app/globals.css`, and it matches the live components:

- Summary and states: `.diff-summary`, `.diff-metadata`, `.diff-state`,
  `.diff-state-error`, `.diff-state-unparseable`, `.diff-raw`
- Controls and index: `.diff-actions`, `.diff-action`, `.diff-index`,
  `.diff-index-row`, `.diff-disclosure`
- Files: `.diff-files`, `.diff-file`, `.diff-file-header`, `.diff-file-path`,
  `.diff-file-status`, `.diff-file-counts`
- Patch: `.diff-code`, `.diff-file-metadata`, `.diff-hunk`, `.diff-line`,
  `.diff-line-number`, `.diff-line-status`, `.diff-prefix`, `.diff-reveal`
- Row states: `.diff-line-addition`, `.diff-line-deletion`, `.diff-line-context`,
  `.diff-line-meta`

The viewer uses only the existing ground, rule, ink, mark, and cue tokens. It
adds no competing diff palette or typography system. The line grid narrows
below 640px, controls use the shared cobalt focus treatment, and forced-colors
borders keep addition/deletion meaning from depending on color.
