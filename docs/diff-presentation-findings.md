# Diff presentation contracts

This is the single repository note for the contracts and resulting structured-diff implementation on run and artifact pages. Citations identify the files that establish each contract.

## API and artifact shape

- The API uses the global `/api` prefix. Run detail is `GET /api/runs/:id`, and artifact detail is `GET /api/runs/:id/artifacts/:artifactId`.
- Run detail embeds artifact summaries with `id`, `kind`, `contentHash`, and `createdAt`; it does not embed the artifact body.
- Artifact detail returns the persisted artifact row, including `content`, or a 404. `apiGet<T>` is an unchecked cast, so the web reader validates that object content has a string `diff` field.
- Legacy string content is accepted by the artifact view and run-diff proxy. Unavailable or malformed content is an explicit error state rather than an empty diff.
- Both workers persist `{ diff, baseBranch, branch }` for `diff` artifacts. Task, stage, and iteration provenance remains optional.
- A run may contain multiple diff artifacts. The run page selects the latest summary in the API's ascending artifact order.
- The artifact route delegates rendering to `artifact-view.tsx`. Diff artifacts use the shared run-level `DiffPresentation`; every other artifact retains the JSON rendering fallback.
- The artifact-local diff viewer was removed. Both the run and artifact routes now use `apps/web/src/app/runs/[id]/diff-viewer.tsx` and `apps/web/src/lib/unified-diff.ts`.
- It fetches `GET /runs/${id}/artifacts/${artifactId}` through `apiGet`, and the body field it renders is exactly `content`, not `body` or `data` (`apps/web/src/app/runs/[id]/artifacts/[artifactId]/page.tsx:5-11`, `apps/web/src/app/runs/[id]/artifacts/[artifactId]/page.tsx:18-19`, `apps/web/src/app/runs/[id]/artifacts/[artifactId]/page.tsx:29-32`). The web helper adds the `/api` prefix to the configured API origin (`apps/web/src/lib/api.ts:4-5`, `apps/web/src/lib/api.ts:14-17`).
- Fetch failure is not handled locally. `apiGet` throws for a non-2xx response, and the page awaits it without `try`/`catch`, a route error state, or `notFound()` (`apps/web/src/lib/api.ts:14-17`, `apps/web/src/app/runs/[id]/artifacts/[artifactId]/page.tsx:13-20`).
- A full artifact row may have `content: null` and a non-null `storageRef`, because large artifacts are offloaded and exactly one storage location is intended (`packages/db/src/schema.ts:250-265`, `apps/worker/src/artifacts.ts:18-33`). `getArtifact` returns the raw selected row and does not hydrate object-storage content (`apps/api/src/api.service.ts:303-310`). Downstream UI must therefore tolerate absent/non-string `content`; it must not assume every `diff` response already contains inline text.

## Run-page composition and loading

- The run page fetches its primary `RunDetail` first. Full diff content is then loaded through the server-only `/run-diffs/:runId/:artifactId` proxy.
- The client loader is keyed by immutable artifact ID, so live run refreshes do not repeatedly block on or fetch the same full blob.
- The run error appears before Code changes. Artifact-fetch failures have their own rendered error branch and are never presented as no changes.
- The artifact detail route reuses `DiffPresentation`, so parsing and state behavior do not diverge between views.
- With four or more changed files, file bodies start collapsed and are not mounted. One to three files remain initially open.
- Each file initially renders at most 400 patch lines. Additional lines are available through an explicit reveal control.
- `page.tsx` is an App Router server component: it has no client directive, exports an async page, awaits route params, and performs its API read directly (`apps/web/src/app/runs/[id]/page.tsx:1-22`). `system.tsx` likewise has no client directive or client hook and exports a plain render function, so `RunSystem` remains server-renderable (`apps/web/src/app/runs/[id]/system.tsx:1-2`, `apps/web/src/app/runs/[id]/system.tsx:59-63`).
- The page composes `RunSystem` as the child of the first `System` section, passing the full `RunDetail` as `run` (`apps/web/src/app/runs/[id]/page.tsx:86-100`).
- The Code changes section sits after the separate run-error block and before the pending-gate map, preserving error prominence while leaving the gate, run-system, findings, and artifact-list surfaces untouched. No navigation surface is defined in this page.

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
- The package name is exactly `@ai-system/web` (`apps/web/package.json:1-4`).
- The existing test script is `vitest run --passWithNoTests`, and `vitest` is already declared as `^3.0.0` in `devDependencies` (`apps/web/package.json:5-10`, `apps/web/package.json:17-24`).
- `@testing-library/react` and `jsdom` are absent from both dependency sections; the declared runtime dependencies are only Next, React, and React DOM, while the listed dev dependencies are Tailwind/PostCSS, React types, TypeScript, and Vitest (`apps/web/package.json:12-24`). Tests should therefore stay pure/Node unless the manifest is intentionally changed.
- `apps/web/vitest.config.ts` and the existing test script keep pure `src/**/*.test.ts` and `src/**/*.test.tsx` tests in the Node environment; parser and presentation-helper coverage remains in `apps/web/src/lib`.

## Test setup and constraints

- `apps/web` is package `@ai-system/web`. Its `test` script runs `vitest run --passWithNoTests`, and Vitest is already declared in `devDependencies`.
- `apps/web/vitest.config.ts` supplies JSX handling and the `@` source alias. DOM test dependencies are intentionally unnecessary because component coverage uses server rendering and logic coverage stays in the Node environment.
- Treat artifact `content`, `diff`, `baseBranch`, and `branch` as runtime-optional; object-storage rows may return `content: null`.
- Do not assume one diff per run or add API payload keys as part of this read-only presentation work.
- Preserve the exact design-token vocabulary and the single parser, viewer, line-cap helper, and test suite for each behavior.

### Color contract

- The normative CSS custom properties are `--color-ground`, `--color-ground-raised`, `--color-ground-band`, `--color-rule`, `--color-rule-strong`, `--color-ink`, `--color-ink-secondary`, `--color-ink-muted`, `--color-ink-label`, `--color-ink-faint`, `--color-mark`, `--color-mark-deep`, `--color-mark-bright`, `--color-cue`, `--color-cue-deep`, `--color-cue-bright`, `--color-hold`, and `--color-hold-bright` (`apps/web/src/app/globals.css:7-33`).
- The requested semantic mappings are: vermilion = `--color-mark`; bright vermilion = `--color-mark-bright`; cobalt = `--color-cue` and its text-safe/bright step `--color-cue-bright`; Bone Ink = `--color-ink`; Bone Muted = `--color-ink-muted`; Bone Faint = `--color-ink-faint` (`DESIGN.md:143-163`, `apps/web/src/app/globals.css:17-31`). The Impeccable sidecar uses the same canonical names and values (`.impeccable/design.json:42-96`).
- **Contradicted premise:** there are no mint or aqua tokens in `DESIGN.md`, `globals.css`, or `.impeccable/design.json`. The committed state hues are instead Conductor's Vermilion (`mark`), Cobalt Cue (`cue`), and Ochre Hold (`hold`) (`DESIGN.md:141-151`, `.impeccable/design.json:72-109`). Downstream styling must not invent mint/aqua custom properties or hex values.
- The existing interaction wash is `--color-ground-raised`, described as the single hover wash (`DESIGN.md:153-156`) and already used as `hover:bg-ground-raised` on artifact rows (`apps/web/src/app/runs/[id]/page.tsx:131-140`).
- The focus idiom is a 2px `--color-cue-bright` outline with 2px offset; inputs additionally change their bottom rule to `--color-cue` (`apps/web/src/lib/ui.tsx:210-224`, `DESIGN.md:228-237`). Reuse the shared classes rather than creating another focus treatment.

### Typography contract

- The named steps are `wordmark` (mono, 1.25rem/700), `headline` (sans, 1.25rem/400), `title` (italic serif, 1rem/400), `body` (sans, 0.875rem/400), `annotation` (italic serif, 0.75rem/400), `readout` (mono, 0.75rem/400, tabular), and `micro` (mono, 0.6875rem/400, tabular) (`DESIGN.md:21-61`). Their intended roles are restated in the hierarchy (`DESIGN.md:181-188`).
- The CSS custom properties for the type families are `--font-sans`, `--font-mono`, and `--font-annot`; the only project-specific size custom property is `--text-micro` with `--text-micro--line-height` (`apps/web/src/app/globals.css:35-44`). Other sizes currently use Tailwind's named utilities, so downstream work should not invent additional custom-property names.

## 8. Shared UI primitive signatures

- `System({ mark, title, aside, children })` requires string `mark` and `title`, optional `React.ReactNode` `aside`, and required `React.ReactNode` `children` (`apps/web/src/lib/ui.tsx:176-197`).
- `Stave({ children, className = '' })` requires `React.ReactNode` children and accepts optional string `className` (`apps/web/src/lib/ui.tsx:205-208`).
- `Caesura({ children })` requires `React.ReactNode` children (`apps/web/src/lib/ui.tsx:200-203`).
- `Hairpin({ direction, className = '' })` requires `direction: 'cresc' | 'dim'` and accepts optional string `className` (`apps/web/src/lib/ui.tsx:138-159`).
- `RehearsalMark({ children })` requires `React.ReactNode` children (`apps/web/src/lib/ui.tsx:162-169`).
- `Notehead({ head, className = '' })` requires `head: 'filled' | 'hollow' | 'cross' | 'rest'` and accepts optional string `className` (`apps/web/src/lib/ui.tsx:12-16`, `apps/web/src/lib/ui.tsx:60-90`).
- `buttonCls` is an exported string constant for the affirmative 2px-mark-border button and includes the shared focus idiom (`apps/web/src/lib/ui.tsx:218-224`). `linkCls` is an exported string constant using cue-bright text, a rule-strong underline, and cue hover decoration (`apps/web/src/lib/ui.tsx:230`).

## Downstream constraints distilled

- Treat run-detail artifact entries as summaries and fetch full content from the per-artifact endpoint (`apps/api/src/api.service.ts:269-310`).
- Treat `content`, `diff`, `baseBranch`, and `branch` as runtime-optional even for `kind === 'diff'`, because the API is unvalidated on the web side and object-storage rows may return `content: null` (`apps/web/src/lib/api.ts:14-17`, `packages/db/src/schema.ts:257-263`, `apps/api/src/api.service.ts:303-310`).
- Do not assume one diff per run; storage permits many and worker consumers explicitly select the latest (`packages/db/src/schema.ts:250-265`, `apps/worker/src/mvp-stages.ts:100-107`).
- Do not add API payload keys as part of this read-only presentation work (`apps/api/src/dto.ts:5-25`).
- Preserve the existing test script/dependency and the exact design-token vocabulary; in particular, do not introduce mint/aqua aliases or literal replacement colors (`apps/web/package.json:5-24`, `apps/web/src/app/globals.css:7-44`).

## Implemented diff styling contract

### Styling ground truth

The web theme is defined in `apps/web/src/app/globals.css`. The shipped run and artifact views share the same `DiffPresentation` component and use only existing custom properties:

- Addition and deletion rows use the existing raised/band grounds and distinct solid/dashed rules, so their meaning survives grayscale and forced-colors modes.
- Hunk headers and focus use `--color-cue-bright`; errors use the text-safe `--color-mark-bright` with a `--color-mark` rule.
- Rules and gutters: `--color-rule`, `--color-rule-strong`, `--color-ink-label`, and `--color-ink-faint`.
- Code uses `--font-mono` with tabular line numbers. Line numbers and prefixes are excluded from copied source text.
- The raw fallback for non-empty, unparseable content uses the same ruled, horizontally scrollable code treatment rather than reporting a false empty state.

The existing small breakpoint begins at 640px. Below it, summary metadata stacks, file controls reflow, and the line-number tracks shrink without a conflicting minimum width.

### CSS class contract

- Summary and artifact metadata: `.diff-summary`, `.diff-metadata`, `.diff-state`, `.diff-raw`
- Actions: `.diff-actions`, `.diff-action`
- File index: `.diff-index`, `.diff-index-row`, `.diff-disclosure`, `.diff-file-path`, `.diff-file-status`, `.diff-file-counts`
- File shell: `.diff-files`, `.diff-file`, `.diff-file-header`, `.diff-code`, `.diff-file-metadata`
- Patch content: `.diff-hunk`, `.diff-line`, `.diff-line-number`, `.diff-line-status`, `.diff-prefix`, `.diff-reveal`
- Row states: `.diff-line-addition`, `.diff-line-deletion`, `.diff-line-context`, `.diff-line-meta`

File headers are intentionally non-sticky. Collapsed file bodies are not mounted, and expanded files initially render at most 400 parsed lines with an explicit control for the remainder. JavaScript scrolling checks `prefers-reduced-motion` before requesting smooth motion.
