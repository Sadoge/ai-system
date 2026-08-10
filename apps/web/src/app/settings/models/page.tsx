import { apiGet, type ModelProfileRow } from '@/lib/api';
import { addModelProfileAction } from '@/lib/actions';
import { System, buttonCls, inputCls } from '@/lib/ui';

export default async function ModelsPage() {
  const profiles = await apiGet<ModelProfileRow[]>('/model-profiles');

  return (
    <main>
      <System mark="A" title="Assign a part">
        <form action={addModelProfileAction} className="flex flex-wrap items-end gap-x-6 gap-y-4">
          <label className="flex flex-col gap-1">
            <span className="annot text-xs text-ink-label">Purpose</span>
            <input name="purpose" required className={inputCls} placeholder="planning" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="annot text-xs text-ink-label">Provider</span>
            <input name="provider" required className={inputCls} placeholder="anthropic" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="annot text-xs text-ink-label">Model</span>
            <input name="model" required className={inputCls} placeholder="claude-sonnet-5" />
          </label>
          <button type="submit" className={buttonCls}>
            Add
          </button>
        </form>
        <p className="annot mt-4 max-w-2xl text-sm leading-relaxed text-ink-label">
          Resolution cascade: project profile → org profile → platform default. Overrides apply to
          new runs — profiles freeze into the run&apos;s policy at start.
        </p>
      </System>

      <System mark="B" title="Assignments" aside={`${profiles.length}`}>
        {profiles.length === 0 ? (
          <p className="annot py-4 text-sm text-ink-label">
            No overrides — platform defaults are in effect.
          </p>
        ) : (
          <ul className="border-t border-rule">
            {profiles.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-rule px-1 py-2.5"
              >
                <span className="font-mono text-sm text-cue-bright">{p.purpose}</span>
                <span className="font-mono text-sm text-ink-secondary">
                  {p.provider}/{p.model}
                </span>
                <span className="ml-auto font-mono text-xs text-ink-faint">
                  {p.projectId ? 'project' : p.organizationId ? 'org' : 'platform'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </System>
    </main>
  );
}
