import { apiGet, type ModelProfileRow } from '@/lib/api';
import { addModelProfileAction } from '@/lib/actions';
import { System, buttonCls, inputCls, selectCls } from '@/lib/ui';

const purposes = [
  ['classifier', 'Classify ticket'],
  ['research', 'Research repository'],
  ['planning', 'Plan change'],
  ['decomposition', 'Split work into tasks'],
  ['coding', 'Write code'],
  ['integration', 'Resolve merge conflicts'],
  ['review', 'Review code'],
  ['testing', 'Analyze test results'],
  ['documentation', 'Write change summary'],
  ['distillation', 'Extract project knowledge'],
] as const;

interface ProjectOption {
  id: string;
  name: string;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex min-w-40 flex-1 flex-col gap-1">
      <span className="annot text-xs text-ink-label">{label}</span>
      {children}
    </label>
  );
}

function providerName(provider: string): string {
  if (provider === 'claude_cli') return 'Claude subscription';
  if (provider === 'codex_cli') return 'Codex subscription';
  return provider;
}

export default async function ModelsPage() {
  const [profiles, projects] = await Promise.all([
    apiGet<ModelProfileRow[]>('/model-profiles'),
    apiGet<ProjectOption[]>('/projects'),
  ]);
  const projectNames = new Map(projects.map((project) => [project.id, project.name]));

  return (
    <main>
      <System mark="A" title="Assign an agent to a stage">
        <form action={addModelProfileAction} className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
            <Field label="Stage responsibility">
              <select name="purpose" required className={selectCls} defaultValue="coding">
                {purposes.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Subscription agent">
              <select name="provider" required className={selectCls} defaultValue="claude_cli">
                <option value="claude_cli">Claude</option>
                <option value="codex_cli">Codex</option>
              </select>
            </Field>
            <Field label="Model or alias">
              <input
                name="model"
                required
                className={inputCls}
                defaultValue="default"
                aria-describedby="model-help"
              />
            </Field>
            <Field label="Reasoning effort">
              <select name="reasoningEffort" required className={selectCls} defaultValue="low">
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </Field>
            <Field label="Applies to">
              <select name="projectId" className={selectCls} defaultValue="">
                <option value="">Every project</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-4 border-t border-rule pt-3">
            <p id="model-help" className="annot max-w-3xl text-sm leading-relaxed text-ink-label">
              <span className="font-mono not-italic text-ink-secondary">default</span> uses the
              model selected by that CLI. Enter any model name or alias your installed Claude or
              Codex CLI accepts. Low effort uses the least reasoning time and subscription
              allowance.
            </p>
            <button type="submit" className={buttonCls}>
              Save assignment
            </button>
          </div>
        </form>
      </System>

      <System mark="B" title="Active assignments" aside={`${profiles.length}`}>
        {profiles.length === 0 ? (
          <p className="annot py-4 text-sm text-ink-label">
            No explicit assignments yet. New runs use the first authenticated subscription CLI.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[42rem] border-collapse text-left">
              <thead>
                <tr className="border-b border-rule-strong">
                  <th className="annot px-1 py-2 text-xs text-ink-label">stage</th>
                  <th className="annot px-1 py-2 text-xs text-ink-label">agent</th>
                  <th className="annot px-1 py-2 text-xs text-ink-label">model</th>
                  <th className="annot px-1 py-2 text-xs text-ink-label">effort</th>
                  <th className="annot px-1 py-2 text-xs text-ink-label">scope</th>
                </tr>
              </thead>
              <tbody>
                {profiles.map((profile) => (
                  <tr key={profile.id} className="border-b border-rule">
                    <td className="px-1 py-2.5 font-mono text-sm text-ink">{profile.purpose}</td>
                    <td className="px-1 py-2.5 font-mono text-sm text-ink-secondary">
                      {providerName(profile.provider)}
                    </td>
                    <td className="px-1 py-2.5 font-mono text-sm text-ink-secondary">
                      {profile.model}
                    </td>
                    <td className="px-1 py-2.5 font-mono text-sm text-ink-muted">
                      {String(profile.params.reasoningEffort ?? 'default')}
                    </td>
                    <td className="px-1 py-2.5 font-mono text-xs text-ink-faint">
                      {profile.projectId
                        ? (projectNames.get(profile.projectId) ?? 'project')
                        : 'every project'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="annot mt-4 max-w-3xl text-sm leading-relaxed text-ink-label">
          Project assignments override organization-wide assignments. Changes apply when a worker
          first resolves a new run; an active run keeps the assignments it already loaded.
        </p>
      </System>
    </main>
  );
}
