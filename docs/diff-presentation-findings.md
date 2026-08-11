# Diff presentation findings

This is the single repository note for the shipped structured-diff implementation.

## Data contract

- `GET /api/runs/:id` is declared in `apps/api/src/api.controller.ts` and returns artifact
  summaries selected in `apps/api/src/api.service.ts`: `id`, `kind`, `contentHash`, and
  `createdAt`. The web view therefore cannot read diff content from the run response.
- `GET /api/runs/:id/artifacts/:artifactId` returns the full persisted artifact row. The
  artifact table in `packages/db/src/schema.ts` allows inline `content` or a `storageRef`, so
  the web view treats absent inline content as an error instead of an empty diff.
- Both the MVP and team workers persist diff artifacts as
  `{ diff, baseBranch, branch }` (`apps/worker/src/mvp-stages.ts` and
  `apps/worker/src/team-stages.ts`). Additional provenance fields remain optional because the
  database and API do not enforce the JSON content shape.
- A run may contain multiple diff artifacts. The run page selects the latest summary and caches
  its immutable detail response by run and artifact id, avoiding another full-blob API request
  on every live refresh.

## Presentation contract

- `apps/web/src/app/runs/[id]/code-changes.tsx` owns empty, unavailable, unparseable, and parsed
  states. Empty or whitespace patches say there are no file changes. Non-empty content with no
  parsed files is identified as unparseable and shown verbatim.
- The run page places the run error before Code changes. The artifact detail view reuses the same
  `DiffPresentation`, so parsing behavior does not diverge by route.
- `apps/web/src/lib/unified-diff.ts` is the only unified-diff parser. Its Vitest suite covers
  quoted and spaced paths, file status metadata, no-newline markers, malformed and truncated
  content, stable ids, trimmed empty context, and hunk lines that resemble file headers.
- `apps/web/src/app/runs/[id]/diff-viewer.tsx` is the only diff viewer. Collapsed file bodies are
  not mounted. Expanded files render at most 400 lines until the operator explicitly reveals the
  remainder, and scrolling honors `prefers-reduced-motion`.

## Styling and accessibility contract

- The viewer renders `.diff-index` navigation followed by `.diff-files`. Each `.diff-file`
  contains a non-sticky `.diff-file-header` button and, only while expanded, a `.diff-code`
  region. The corresponding styles live in the single Code changes block in `globals.css`.
- Code rows use `.diff-line` with two aria-hidden `.diff-line-number` cells, a
  `.diff-line-status` cell, a non-selectable `.diff-prefix`, and a `code` cell. Only additions
  and deletions receive a status word; unchanged rows leave that cell empty.
- Prefixes sit outside `code`, so copied selections contain source text rather than diff markers.
  Addition/deletion status words and forced-colors borders keep meaning from depending on color.
- The line grid narrows below 640px. Interactive controls use the shared cobalt focus treatment,
  and programmatic scrolling becomes instant when reduced motion is requested.
