# Diff presentation recon findings

This note records the repository contracts that the structured-diff work must use. Citations refer to the current worktree and use one-based line numbers.

## 1. Current artifact route

- The artifact route delegates rendering to `artifact-view.tsx`. Diff artifacts use the shared run-level `DiffPresentation`; every other artifact retains the JSON rendering fallback.
- The artifact-local diff viewer was removed. Both the run and artifact routes now use `apps/web/src/app/runs/[id]/diff-viewer.tsx` and `apps/web/src/lib/unified-diff.ts`.
- It fetches `GET /runs/${id}/artifacts/${artifactId}` through `apiGet`, and the body field it renders is exactly `content`, not `body` or `data` (`apps/web/src/app/runs/[id]/artifacts/[artifactId]/page.tsx:5-11`, `apps/web/src/app/runs/[id]/artifacts/[artifactId]/page.tsx:18-19`, `apps/web/src/app/runs/[id]/artifacts/[artifactId]/page.tsx:29-32`). The web helper adds the `/api` prefix to the configured API origin (`apps/web/src/lib/api.ts:4-5`, `apps/web/src/lib/api.ts:14-17`).
- Fetch failure is not handled locally. `apiGet` throws for a non-2xx response, and the page awaits it without `try`/`catch`, a route error state, or `notFound()` (`apps/web/src/lib/api.ts:14-17`, `apps/web/src/app/runs/[id]/artifacts/[artifactId]/page.tsx:13-20`).
- A full artifact row may have `content: null` and a non-null `storageRef`, because large artifacts are offloaded and exactly one storage location is intended (`packages/db/src/schema.ts:250-265`, `apps/worker/src/artifacts.ts:18-33`). `getArtifact` returns the raw selected row and does not hydrate object-storage content (`apps/api/src/api.service.ts:303-310`). Downstream UI must therefore tolerate absent/non-string `content`; it must not assume every `diff` response already contains inline text.

## 2. Run page and composition seam

- `page.tsx` is an App Router server component: it has no client directive, exports an async page, awaits route params, and performs its API read directly (`apps/web/src/app/runs/[id]/page.tsx:1-22`). `system.tsx` likewise has no client directive or client hook and exports a plain render function, so `RunSystem` remains server-renderable (`apps/web/src/app/runs/[id]/system.tsx:1-2`, `apps/web/src/app/runs/[id]/system.tsx:59-63`).
- The page composes `RunSystem` as the child of the first `System` section, passing the full `RunDetail` as `run` (`apps/web/src/app/runs/[id]/page.tsx:86-100`).
- The programme-head/status block ends before the separate run-error block (`apps/web/src/app/runs/[id]/page.tsx:31-50`). A run-level Code changes section can be inserted after that error block and before the pending-gate map begins, preserving error prominence while leaving the gate, run-system, findings, and artifact-list surfaces untouched (`apps/web/src/app/runs/[id]/page.tsx:46-53`, `apps/web/src/app/runs/[id]/page.tsx:86-147`). No navigation surface is defined in this page (`apps/web/src/app/runs/[id]/page.tsx:1-17`).

## 3. API routes and response shapes

- Nest applies the global `api` prefix, while the controller itself has no local prefix (`apps/api/src/main.ts:12-15`, `apps/api/src/api.controller.ts:36-39`). The exact HTTP routes are therefore `GET /api/runs/:id` and `GET /api/runs/:id/artifacts/:artifactId` (`apps/api/src/api.controller.ts:163-175`). There is **no** controller route for `GET /api/runs/:id/artifacts`; the controller goes directly from run detail to per-artifact detail (`apps/api/src/api.controller.ts:151-177`).
- Run detail embeds artifact **summaries**. The service selects only `id`, `kind`, `contentHash`, and `createdAt`, orders them oldest first, and returns them under `artifacts` alongside stages, findings, gates, cost, and tasks (`apps/api/src/api.service.ts:269-300`). The web mirror describes the same four summary fields (`apps/web/src/lib/api.ts:48-81`).
- Per-artifact detail verifies the run belongs to the principal, selects the full artifact row by both `runId` and `artifactId`, returns that row, and throws `unknown artifact` when absent (`apps/api/src/api.service.ts:303-310`). The full persisted shape is `id`, `runId`, `kind`, `content`, `storageRef`, `contentHash`, `createdByAgentRunId`, and `createdAt` (`packages/db/src/schema.ts:250-265`).
- The canonical artifact-kind enum values are `ticket_snapshot`, `research_report`, `implementation_plan`, `task_plan`, `task_spec`, `diff`, `integration_report`, `review_report`, `test_report`, `documentation`, `pr_package`, `agent_transcript`, and `echo_output` (`packages/domain/src/enums.ts:130-145`).
- `apiGet<T>` performs no runtime validation: after checking HTTP status it casts `res.json()` to `Promise<T>` (`apps/web/src/lib/api.ts:14-17`). Its generic is a caller claim, not evidence of the API response shape.
- This recon requires no request change. Request bodies are parsed through Zod before use, and `StartRunBody` is the current run-creation contract (`apps/api/src/dto.ts:5-25`). Do not add a diff-related request key from the web without a matching DTO/API change.

## 4. Artifact persistence and metadata

- The artifact kind for unified diffs/patches is exactly `diff`; there is no `patch` kind (`packages/domain/src/enums.ts:130-145`).
- The artifact table has no dedicated base-branch, working-branch, task-id, stage, or iteration column. Its only ownership/provenance fields are `runId` and optional `createdByAgentRunId`; branch or iteration data can exist only inside the untyped JSON `content` unless the schema changes (`packages/db/src/schema.ts:250-265`).
- A diff artifact produced by the linear code stage currently puts `{ diff, baseBranch, branch }` in `content`, so base and working branch names are available for those artifacts, but task id, stage, and iteration are not part of that diff payload (`apps/worker/src/mvp-stages.ts:324-331`). These fields must remain optional and conditionally rendered because the database/API do not enforce this content shape (`packages/db/src/schema.ts:257-263`).
- `createdByAgentRunId` can provide indirect provenance when populated: agent runs separately carry optional `stageExecutionId` and `taskId` (`packages/db/src/schema.ts:226-247`). That is not embedded in run-detail artifact summaries and is not joined by the artifact-detail service (`apps/api/src/api.service.ts:278-286`, `apps/api/src/api.service.ts:303-310`).
- Branch data exists elsewhere but must not be mistaken for artifact columns: repositories persist `defaultBranch`, runs persist `repositoryId` and `iterationCount`, and tasks persist their own nullable `branch` (`packages/db/src/schema.ts:116-132`, `packages/db/src/schema.ts:137-163`, `packages/db/src/schema.ts:190-208`).

## 5. Diff production and branch sources

- `createArtifact` always creates a fresh UUID, hashes the serialized content, optionally offloads it, and inserts a new row; it does not upsert by run and kind (`apps/worker/src/artifacts.ts:8-34`). The database index on `(runId, kind)` is non-unique, so more than one `diff` artifact can exist for one run (`packages/db/src/schema.ts:250-265`).
- The linear code stage commits all work, computes `git diff <defaultBranch>...HEAD`, and inserts a new `diff` artifact containing the raw unified diff plus `baseBranch` and `branch` (`apps/worker/src/mvp-stages.ts:324-337`, `packages/contexts/agent-execution/src/git.ts:81-83`). Re-running that stage, including a later fix iteration, therefore adds another diff row rather than replacing the previous one (`apps/worker/src/artifacts.ts:17-33`).
- The team pipeline produces the same payload shape later, after merging completed task branches into the run branch: integration computes the run-branch diff against the repository default branch and inserts `{ diff, baseBranch, branch }` as a fresh `diff` artifact (`apps/worker/src/team-stages.ts:274-316`, `apps/worker/src/team-stages.ts:329-337`). Its companion `integration_report` carries the run iteration, but the `diff` content itself does not (`apps/worker/src/team-stages.ts:317-335`). Unlike the linear diff creation, this team diff does not set `createdByAgentRunId` (`apps/worker/src/team-stages.ts:332-336`, `apps/worker/src/mvp-stages.ts:326-331`).
- Consumers deliberately select the latest artifact of a given kind by descending `createdAt` with `limit(1)` (`apps/worker/src/mvp-stages.ts:100-107`). Review and packaging both use that helper for `diff`, so a run-level view should decide explicitly whether it shows all diff artifacts or the latest one rather than assuming uniqueness (`apps/worker/src/mvp-stages.ts:340-348`, `apps/worker/src/mvp-stages.ts:463-472`).
- The base branch comes from the repository's persisted `defaultBranch` (`packages/db/src/schema.ts:116-131`). The run working branch is derived, not stored on the run, as `ai/run-${run.id.slice(-8)}`; a task branch is derived as `${runBranch(run)}-t-${taskId.slice(-8)}` (`apps/worker/src/mvp-stages.ts:65-84`).
- In the team pipeline, the derived task branch is persisted on each task and task worktrees fork from the derived run branch; fix iterations therefore build on already integrated run-branch work (`apps/worker/src/team-stages.ts:80-103`, `apps/worker/src/team-stages.ts:153-163`). These task branch names still do not appear in the final run-level diff payload (`apps/worker/src/team-stages.ts:329-336`).
- `packageStage` uses the same derived run branch, reads the latest diff, and records `branch`, `baseBranch`, and a summarized diff stat in the `pr_package` content (`apps/worker/src/mvp-stages.ts:463-484`, `apps/worker/src/mvp-stages.ts:516-531`). This corroborates the names but does not make them first-class artifact fields.

## 6. Web test setup

- The package name is exactly `@ai-system/web` (`apps/web/package.json:1-4`).
- The existing test script is `vitest run --passWithNoTests`, and `vitest` is already declared as `^3.0.0` in `devDependencies` (`apps/web/package.json:5-10`, `apps/web/package.json:17-24`).
- `@testing-library/react` and `jsdom` are absent from both dependency sections; the declared runtime dependencies are only Next, React, and React DOM, while the listed dev dependencies are Tailwind/PostCSS, React types, TypeScript, and Vitest (`apps/web/package.json:12-24`). Tests should therefore stay pure/Node unless the manifest is intentionally changed.
- `apps/web/vitest.config.ts` keeps pure `src/**/*.test.ts` and `src/**/*.test.tsx` tests in the Node environment; the parser and view-model coverage uses that existing setup.

## 7. Design tokens and idioms

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

The web theme is defined in `apps/web/src/app/globals.css`. Diff styling uses only its existing custom properties:

- Addition and deletion rows use the existing raised/band grounds and distinct solid/dashed rules, so their meaning survives grayscale and forced-colors modes.
- Hunk headers and focus use `--color-cue-bright`; errors use the text-safe `--color-mark-bright` with a `--color-mark` rule.
- Rules and gutters: `--color-rule`, `--color-rule-strong`, `--color-ink-label`, and `--color-ink-faint`.
- Code: `--font-mono` with tabular figures.

The existing small breakpoint begins at 640px. Below it, summary metadata stacks, file controls reflow, and the line-number tracks shrink without a conflicting minimum width.

### CSS class contract

- File shell: `.diff-file`
- Non-sticky file control: `.diff-file-header`, with `.diff-disclosure`, `.diff-file-path`, `.diff-file-status`, and `.diff-file-counts`
- File index and actions: `.diff-index`, `.diff-index-row`, `.diff-actions`, `.diff-action`
- Horizontal code scroller: `.diff-code`
- Code row and cells: `.diff-line`, `.diff-line-number`, `.diff-line-status`, `.diff-prefix`
- Row states: `.diff-line-addition`, `.diff-line-deletion`, `.diff-line-context`, `.diff-line-meta`
- Metadata and disclosure: `.diff-file-metadata`, `.diff-hunk`, `.diff-reveal`
- Load, empty, parse-failure, and raw-content states: `.diff-state`, `.diff-state-error`, `.diff-raw`

File content is mounted only while its file is expanded. Opened files initially render at most 400 lines and expose the remainder through `.diff-reveal`.
