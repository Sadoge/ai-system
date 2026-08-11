# Diff presentation contracts

This is the single repository note for the structured diff shown on run and artifact pages.

## API and artifact shape

- The API uses the global `/api` prefix. Run detail is `GET /api/runs/:id`, and artifact detail is `GET /api/runs/:id/artifacts/:artifactId`.
- Run detail embeds artifact summaries with `id`, `kind`, `contentHash`, and `createdAt`; it does not embed the artifact body.
- Artifact detail returns the persisted artifact row, including `content`, or a 404. `apiGet<T>` is an unchecked cast, so the web reader validates that object content has a string `diff` field.
- Legacy string content is accepted by the artifact view and run-diff proxy. Unavailable or malformed content is an explicit error state rather than an empty diff.
- Both workers persist `{ diff, baseBranch, branch }` for `diff` artifacts. Task, stage, and iteration provenance remains optional.
- A run may contain multiple diff artifacts. The run page selects the latest summary in the API's ascending artifact order.

## Run-page composition and loading

- The run page fetches its primary `RunDetail` first. Full diff content is then loaded through the server-only `/run-diffs/:runId/:artifactId` proxy.
- The client loader is keyed by immutable artifact ID, so live run refreshes do not repeatedly block on or fetch the same full blob.
- The run error appears before Code changes. Artifact-fetch failures have their own rendered error branch and are never presented as no changes.
- The artifact detail route reuses `DiffPresentation`, so parsing and state behavior do not diverge between views.
- With four or more changed files, file bodies start collapsed and are not mounted. One to three files remain initially open.
- Each file initially renders at most 400 patch lines. Additional lines are available through an explicit reveal control.

## Parser and rendering behavior

- `apps/web/src/lib/unified-diff.ts` is the only unified-diff parser. It handles git headers, headerless patches, quoted and spaced paths, additions, deletions, renames, binary markers, mode metadata, no-newline markers, and trimmed empty context lines.
- Hunk-body parsing runs before `--- ` and `+++ ` file-marker parsing so changed source beginning with `-- ` or `++ ` remains source.
- Empty input and nonempty unparseable input are distinct states. Empty patches get the no-changes message; unparseable patches expose stored content in a labeled, keyboard-focusable region.
- `capHunkLines` is the only initial-render line-capping helper. Long unchanged runs inside a hunk use `RevealLines`, while changed lines and nearby context remain visible.
- Diff prefixes and line-number gutters are aria-hidden and non-selectable. Prefixes sit outside `code`, so copied selections contain source text rather than diff markers.
- File-toggle scrolling checks `prefers-reduced-motion` before requesting smooth scrolling.

## Shipped CSS class contract

The only diff stylesheet is the Code changes block in `apps/web/src/app/globals.css`, matching the live component path `page.tsx` → `run-code-changes.tsx` → `code-changes.tsx` → `diff-viewer.tsx`:

- Summary and states: `.diff-summary`, `.diff-metadata`, `.diff-state`, `.diff-state-error`, `.diff-state-unparseable`, `.diff-raw`
- Controls and index: `.diff-actions`, `.diff-action`, `.diff-index`, `.diff-index-row`, `.diff-disclosure`
- Files: `.diff-files`, `.diff-file`, `.diff-file-header`, `.diff-file-path`, `.diff-file-status`, `.diff-file-counts`
- Patch: `.diff-code`, `.diff-file-metadata`, `.diff-hunk`, `.diff-line`, `.diff-line-number`, `.diff-line-status`, `.diff-prefix`, `.diff-reveal`
- Row states: `.diff-line-addition`, `.diff-line-deletion`, `.diff-line-context`, `.diff-line-meta`

File headers are normal in-flow controls, `.diff-code` owns horizontal overflow, and closed files do not mount their patch body. The viewer uses only the existing ground, rule, ink, mark, cue, and hold tokens. The line grid narrows below 640px, controls use the shared cobalt focus treatment, and forced-colors borders preserve addition/deletion meaning.

## Design tokens and shared UI

- The canonical colors are `--color-ground`, `--color-ground-raised`, `--color-ground-band`, `--color-rule`, `--color-rule-strong`, the `--color-ink-*` family, the `--color-mark-*` family, the `--color-cue-*` family, and the `--color-hold-*` family.
- There are no mint or aqua tokens in `DESIGN.md`, `globals.css`, or `.impeccable/design.json`; downstream styling must not invent them.
- The existing interaction wash is `--color-ground-raised`. The focus idiom is a 2px `--color-cue-bright` outline with a 2px offset.
- The type families are `--font-sans`, `--font-mono`, and `--font-annot`. Other sizes use existing Tailwind utilities rather than new custom properties.
- `System` provides the Code changes section shell, while `linkCls` supplies the shared artifact-link treatment.

## Test setup and constraints

- `apps/web` is package `@ai-system/web`. Its `test` script runs `vitest run --passWithNoTests`, and Vitest is already declared in `devDependencies`.
- `apps/web/vitest.config.ts` supplies JSX handling and the `@` source alias. DOM test dependencies are intentionally unnecessary because component coverage uses server rendering and logic coverage stays in the Node environment.
- Treat artifact `content`, `diff`, `baseBranch`, and `branch` as runtime-optional; object-storage rows may return `content: null`.
- Do not assume one diff per run or add API payload keys as part of this read-only presentation work.
- Preserve the exact design-token vocabulary and the single parser, viewer, line-cap helper, and test suite for each behavior.
