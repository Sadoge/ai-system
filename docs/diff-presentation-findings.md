# Diff presentation findings

This is the single recon note for the shipped structured-diff path.

## Data and route contracts

- Run detail contains artifact summaries only. The API selects `id`, `kind`, `contentHash`, and
  `createdAt` in `apps/api/src/api.service.ts`; full content comes from
  `GET /api/runs/:id/artifacts/:artifactId`, declared in `apps/api/src/api.controller.ts` and
  returned by `apps/api/src/api.service.ts`.
- A run may contain multiple `diff` artifacts. The run page deliberately selects the latest
  summary and fetches that artifact's full content.
- Diff content is untyped JSON and may be absent when artifact storage is offloaded. The web
  reader therefore treats `diff`, `baseBranch`, `branch`, `task`, `stage`, and `iteration` as
  runtime-optional and preserves fetch/shape failures as a distinct error state.
- The worker currently writes `{ diff, baseBranch, branch }` for linear and team integration
  runs. No request payload or API DTO changes are part of diff presentation.

## Composition and failure states

- `apps/web/src/app/runs/[id]/page.tsx` renders the Code changes system after the run error so a
  failed run's primary error remains prominent.
- The artifact page delegates `diff` artifacts to the same presentation component and keeps the
  JSON view for all other artifact kinds.
- Empty patch text means there are no file changes. Non-empty text that produces no parsed files
  is explicitly labelled unparseable and the stored patch remains available as raw text.
- A failed artifact fetch is never collapsed into an empty/no-changes state.

## Shipped implementation

- `apps/web/src/lib/unified-diff.ts` is the only unified-diff parser. Its Vitest suite covers
  quoted paths, mode-only changes, binary changes, no-newline markers, malformed input, stable
  ids, trimmed empty context, and hunk content beginning with `--- ` or `+++ `.
- `apps/web/src/app/runs/[id]/diff-viewer.tsx` is the only diff viewer. Closed file bodies are not
  rendered; opened files initially render at most 400 patch lines and expose an explicit reveal
  control for the remainder. Long unchanged runs have a separate context reveal.
- Programmatic scrolling honors `prefers-reduced-motion`.
- Line numbers and diff markers are non-selectable presentation columns. Only additions and
  deletions receive status words; unchanged rows do not repeatedly announce “context”.

## Styling contract

The live classes are defined once in `apps/web/src/app/globals.css`:

- Summary and metadata: `.diff-summary`, `.diff-metadata`, `.diff-state`
- File controls: `.diff-actions`, `.diff-index`, `.diff-index-row`, `.diff-files`, `.diff-file`,
  `.diff-file-header`, `.diff-disclosure`, `.diff-file-path`, `.diff-file-status`,
  `.diff-file-counts`
- Patch content: `.diff-code`, `.diff-file-metadata`, `.diff-hunk`, `.diff-line`,
  `.diff-line-number`, `.diff-line-status`, `.diff-prefix`, `.diff-reveal`

The styling uses only the established ground, rule, ink, mark, and cue tokens. File headers are
not sticky, and the code content owns horizontal overflow.

## Test setup

`apps/web` owns these pure logic tests and runs them with its existing `vitest` dependency and
`test` script. No test dependency or workspace import changes are required.
