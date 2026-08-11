# Diff presentation findings

This is the single repository note for the shipped structured-diff implementation.

## Data contract

- `GET /api/runs/:id` is declared in `apps/api/src/api.controller.ts` and returns artifact summaries from `apps/api/src/api.service.ts`. A summary contains `id`, `kind`, `contentHash`, and `createdAt`; it does not contain the artifact body.
- `GET /api/runs/:id/artifacts/:artifactId` is the only full-artifact route. The service verifies that the run belongs to the principal, selects the artifact by both IDs, and returns the persisted row or a 404.
- The canonical artifact kind is `diff`. Current MVP and team workers persist `{ diff, baseBranch, branch }`, but artifact `content` is untyped JSON and can be absent when `storageRef` is populated. The web layer therefore validates every optional field at runtime.
- More than one diff may exist for a run. The run page deliberately selects the latest summary, matching worker consumers that select the latest diff.
- The run page loads full diff content through the server-only `/run-diffs/:runId/:artifactId` proxy. Its client loader is keyed by the immutable artifact ID, so live run refreshes do not repeatedly block on or fetch the same full blob.

## Presentation behavior

- `apps/web/src/lib/unified-diff.ts` is the only unified-diff parser. It retains malformed hunk content where possible and returns no files for content that is not recognizable as a diff.
- Empty content and unparseable content are distinct states. Empty content reports no file changes; non-empty unparseable content displays the stored patch verbatim.
- Files are all initially open only when there are three or fewer. Closed file bodies are not mounted. Open files initially render at most 400 parsed lines and expose an explicit remaining-line control.
- Long unchanged runs within the visible portion are collapsed separately, leaving three context lines on each side.
- File-toggle scrolling follows `prefers-reduced-motion`.
- The run-level error is rendered before Code changes so a failed run's primary diagnosis remains prominent.

## Styling contract

The live classes are defined once in `apps/web/src/app/globals.css` and rendered by `runs/[id]/code-changes.tsx` plus `runs/[id]/diff-viewer.tsx`:

- Summary and states: `.diff-summary`, `.diff-metadata`, `.diff-state`, `.diff-state-error`, `.diff-state-unparseable`, `.diff-raw`
- Controls and index: `.diff-actions`, `.diff-action`, `.diff-index`, `.diff-index-row`, `.diff-disclosure`
- Files: `.diff-files`, `.diff-file`, `.diff-file-header`, `.diff-file-path`, `.diff-file-status`, `.diff-file-counts`
- Patch: `.diff-code`, `.diff-file-metadata`, `.diff-hunk`, `.diff-line`, `.diff-line-addition`, `.diff-line-deletion`, `.diff-line-number`, `.diff-line-status`, `.diff-prefix`, `.diff-reveal`

Headers are ordinary disclosure buttons, not sticky elements. `.diff-code` owns horizontal overflow. Additions and deletions use different ruled neutral bands, explicit words, and ASCII prefixes, so their meaning does not depend on color. Line-number, status, and prefix gutters are non-selectable; copied selections contain source content rather than patch furniture.

The implementation uses only existing theme tokens. It adds no dependency, API request key, artifact kind, or workspace boundary import.
