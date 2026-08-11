# Diff presentation contracts

This is the single recon note for the structured diff shown on run and artifact pages.

## API and artifact shape

- The API uses the global `/api` prefix (`apps/api/src/main.ts`). Run detail is
  `GET /api/runs/:id`, and artifact detail is
  `GET /api/runs/:id/artifacts/:artifactId`
  (`apps/api/src/api.controller.ts`, `getRun` and `getArtifact`).
- Run detail embeds artifact summaries with `id`, `kind`, `contentHash`, and
  `createdAt` (`apps/api/src/api.service.ts`, `getRun`). It does not embed the
  artifact body.
- Artifact detail returns the full persisted artifact row, including `content`,
  or a 404 (`apps/api/src/api.service.ts`, `getArtifact`). The controller does
  not wrap that row in `{ data: ... }`, and `apps/api/src/dto.ts` defines request
  validation rather than a response DTO for this route.
- `apiGet<T>` is an unchecked cast. The web reader therefore validates that a
  diff artifact has object content with a string `diff` field before rendering
  it (`apps/web/src/lib/diff-artifact.ts`).
- Artifact content can be absent when `storageRef` is populated. The current API
  does not hydrate object storage, so unavailable or malformed content remains
  an explicit error state rather than becoming an empty diff.
- Workers currently write `{ diff, baseBranch, branch }` for the `diff` kind
  (`apps/worker/src/mvp-stages.ts` and `apps/worker/src/team-stages.ts`). Optional
  task, stage, and iteration fields are rendered only when they are present.
- More than one diff artifact can exist for a run. The run page selects the
  latest summary in the API's ascending artifact order, matching worker
  consumers that use the latest diff.

## Run-page composition and loading

- The run page fetches its primary `RunDetail` first. Full diff content is read
  by an async child inside a Suspense boundary, so the programme head and run
  error can stream without waiting for the larger artifact request.
- The run error appears before Code changes. This preserves failure prominence.
- Artifact-fetch failures have their own rendered error branch. They are never
  presented as “no changes.”
- With four or more changed files, file bodies start collapsed and are omitted
  from the initial HTML. A body is rendered when its file is expanded. One to
  three files remain initially open for the faster small-review path.
- Each file initially renders at most 400 patch lines. Additional lines are
  available through an explicit “Show remaining N lines” control, so a single
  very large file cannot recreate the same DOM-size problem.

## Parser and rendering behavior

- `apps/web/src/lib/unified-diff.ts` is the only unified-diff parser. It handles
  git headers, headerless unified patches, quoted and spaced paths, additions,
  deletions, renames, binary markers, mode metadata, no-newline markers, and
  trimmed empty context lines.
- Hunk-body parsing runs before `--- ` and `+++ ` file-marker parsing. This is
  required for changed source whose content itself begins with `-- ` or `++ `.
- Empty input and nonempty unparseable input are distinct parser states. Empty
  patches get the no-changes message; unparseable patches expose the stored raw
  content.
- Long unchanged runs inside a hunk use `RevealLines`; changed lines and nearby
  context remain visible.
- Diff prefixes and line-number gutters are not selectable. Only addition and
  deletion rows carry a visible status word, avoiding repeated “context” output
  for assistive technology.
- File-toggle scrolling checks `prefers-reduced-motion` before requesting smooth
  scrolling.

## Shipped CSS class contract

The only diff stylesheet is the “Code changes” block in
`apps/web/src/app/globals.css`, and it matches the live components:

- Summary and states: `.diff-summary`, `.diff-metadata`, `.diff-state`,
  `.diff-state-error`, `.diff-raw`
- Controls and index: `.diff-actions`, `.diff-action`, `.diff-index`,
  `.diff-index-row`, `.diff-disclosure`
- Files: `.diff-files`, `.diff-file`, `.diff-file-header`, `.diff-file-path`,
  `.diff-file-status`, `.diff-file-counts`
- Patch: `.diff-code`, `.diff-file-metadata`, `.diff-hunk`, `.diff-line`,
  `.diff-line-number`, `.diff-line-status`, `.diff-prefix`, `.diff-reveal`
- Row states: `.diff-line-addition`, `.diff-line-deletion`, `.diff-line-context`,
  `.diff-line-meta`

The viewer uses only the existing ground, rule, ink, mark, and cue tokens. It
adds no competing diff palette or typography system.
