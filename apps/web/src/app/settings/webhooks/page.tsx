import { apiGet } from '@/lib/api';
import {
  createWebhookAction,
  redeliverWebhookAction,
  setWebhookActiveAction,
} from '@/lib/actions';
import { Notehead, System, buttonCls, inputCls } from '@/lib/ui';

interface WebhookRow {
  id: string;
  url: string;
  description: string;
  events: string[];
  active: boolean;
  createdAt: string;
  deliveries: { pending: number; delivered: number; failed: number; lastDeliveredAt: string | null };
}

interface DeliveryRow {
  id: string;
  endpointId: string;
  eventName: string;
  status: string;
  attempts: number;
  responseStatus: number | null;
  lastError: string | null;
  nextAttemptAt: string | null;
  createdAt: string;
}

const quietButton =
  'border border-rule-strong px-2 py-1 font-mono text-xs text-ink-muted hover:border-cue hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cue-bright';

export default async function WebhooksPage() {
  const [endpoints, deliveries] = await Promise.all([
    apiGet<WebhookRow[]>('/webhooks'),
    apiGet<DeliveryRow[]>('/webhook-deliveries?limit=25'),
  ]);

  return (
    <main>
      <System mark="A" title="Subscribe an endpoint">
        <form action={createWebhookAction} className="flex flex-wrap items-end gap-x-6 gap-y-4">
          <label className="flex min-w-72 flex-1 flex-col gap-1">
            <span className="annot text-xs text-ink-label">Endpoint URL</span>
            <input
              name="url"
              required
              placeholder="https://example.com/hooks/ai-system"
              className={inputCls}
            />
          </label>
          <label className="flex min-w-64 flex-col gap-1">
            <span className="annot text-xs text-ink-label">Events — blank for all</span>
            <input name="events" placeholder="run.*, gate.requested" className={inputCls} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="annot text-xs text-ink-label">Description</span>
            <input name="description" placeholder="what this is for" className={inputCls} />
          </label>
          <button type="submit" className={buttonCls}>
            Add
          </button>
        </form>
        <p className="annot mt-4 max-w-3xl text-sm leading-relaxed text-ink-label">
          The signing secret is returned once, in the API response. Deliveries carry an HMAC-SHA256
          signature over{' '}
          <span className="font-mono not-italic text-ink-secondary">
            &quot;&lt;timestamp&gt;.&lt;body&gt;&quot;
          </span>{' '}
          — verify it before trusting a payload.
        </p>
      </System>

      <System mark="B" title="Endpoints" aside={`${endpoints.length}`}>
        {endpoints.length === 0 ? (
          <p className="annot py-4 text-sm text-ink-label">No endpoints yet.</p>
        ) : (
          <ul className="border-t border-rule">
            {endpoints.map((endpoint) => (
              <li key={endpoint.id} className="border-b border-rule py-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="truncate font-mono text-sm text-ink">{endpoint.url}</p>
                    <p className="annot mt-1 text-xs text-ink-label">
                      {endpoint.events.length > 0 ? endpoint.events.join(', ') : 'all events'}
                      {endpoint.description ? ` — ${endpoint.description}` : ''}
                    </p>
                  </div>
                  <form action={setWebhookActiveAction} className="shrink-0">
                    <input type="hidden" name="endpointId" value={endpoint.id} />
                    <input type="hidden" name="active" value={String(!endpoint.active)} />
                    <button type="submit" className={quietButton}>
                      {endpoint.active ? 'Disable' : 'Enable'}
                    </button>
                  </form>
                </div>
                <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 font-mono text-xs tnum">
                  <span
                    className={`inline-flex items-center gap-1.5 ${
                      endpoint.active ? 'text-ink-secondary' : 'text-ink-faint'
                    }`}
                  >
                    <Notehead head={endpoint.active ? 'filled' : 'rest'} />
                    {endpoint.active ? 'active' : 'disabled'}
                  </span>
                  <span className="text-ink-muted">delivered {endpoint.deliveries.delivered}</span>
                  <span className="text-ink-muted">pending {endpoint.deliveries.pending}</span>
                  <span
                    className={endpoint.deliveries.failed > 0 ? 'text-mark' : 'text-ink-faint'}
                  >
                    failed {endpoint.deliveries.failed}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </System>

      <System mark="C" title="Recent deliveries" aside={`${deliveries.length}`}>
        {deliveries.length === 0 ? (
          <p className="annot py-4 text-sm text-ink-label">Nothing delivered yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-2xl text-left text-sm">
              <thead>
                <tr className="border-b border-rule-strong">
                  <th className="annot py-1.5 pr-4 font-normal text-ink-label">event</th>
                  <th className="annot py-1.5 pr-4 font-normal text-ink-label">status</th>
                  <th className="annot py-1.5 pr-4 text-right font-normal text-ink-label">
                    attempts
                  </th>
                  <th className="annot py-1.5 pr-4 font-normal text-ink-label">detail</th>
                  <th className="py-1.5" />
                </tr>
              </thead>
              <tbody className="font-mono text-xs text-ink-secondary">
                {deliveries.map((delivery) => (
                  <tr key={delivery.id} className="border-b border-rule">
                    <td className="py-1.5 pr-4">{delivery.eventName}</td>
                    <td
                      className={`py-1.5 pr-4 ${
                        delivery.status === 'failed'
                          ? 'text-mark'
                          : delivery.status === 'delivered'
                            ? 'text-ink-secondary'
                            : 'text-hold-bright'
                      }`}
                    >
                      {delivery.status}
                    </td>
                    <td className="py-1.5 pr-4 text-right tnum">{delivery.attempts}</td>
                    <td className="py-1.5 pr-4 text-ink-faint">
                      {delivery.lastError ??
                        (delivery.responseStatus ? `HTTP ${delivery.responseStatus}` : '')}
                    </td>
                    <td className="py-1.5 text-right">
                      {delivery.status === 'failed' && (
                        <form action={redeliverWebhookAction}>
                          <input type="hidden" name="deliveryId" value={delivery.id} />
                          <button type="submit" className={quietButton}>
                            Redeliver
                          </button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </System>
    </main>
  );
}
