import { apiGet, type ModelProfileRow } from '@/lib/api';
import { addModelProfileAction } from '@/lib/actions';
import { Section, buttonCls, inputCls } from '@/lib/ui';

export default async function ModelsPage() {
  const profiles = await apiGet<ModelProfileRow[]>('/model-profiles');
  return (
    <main>
      <Section title="Add model profile override">
        <form action={addModelProfileAction} className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-zinc-500">Purpose</label>
            <input name="purpose" required className={inputCls} placeholder="planning" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-zinc-500">Provider</label>
            <input name="provider" required className={inputCls} placeholder="anthropic" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-zinc-500">Model</label>
            <input name="model" required className={inputCls} placeholder="claude-sonnet-4-5" />
          </div>
          <button type="submit" className={buttonCls}>
            Add
          </button>
        </form>
        <p className="mt-2 text-xs text-zinc-600">
          Resolution cascade: project profile → org profile → platform default. Overrides apply to
          new runs (profiles freeze into the run's policy at start).
        </p>
      </Section>

      <Section title={`Profiles (${profiles.length})`}>
        <div className="divide-y divide-zinc-800 rounded border border-zinc-800">
          {profiles.map((p) => (
            <div key={p.id} className="flex items-center gap-4 px-4 py-2 text-sm">
              <span className="font-mono text-emerald-400">{p.purpose}</span>
              <span className="font-mono text-zinc-300">
                {p.provider}/{p.model}
              </span>
              <span className="ml-auto font-mono text-xs text-zinc-600">
                {p.projectId ? 'project' : p.organizationId ? 'org' : 'platform'}
              </span>
            </div>
          ))}
          {profiles.length === 0 && (
            <p className="px-4 py-6 text-sm text-zinc-500">
              No overrides — platform defaults are in effect.
            </p>
          )}
        </div>
      </Section>
    </main>
  );
}
