import { apiGet } from '@/lib/api';
import {
  createWebhookAction,
  redeliverWebhookAction,
  setWebhookActiveAction,
} from '@/lib/actions';
import { Section, buttonCls, inputCls } from '@/lib/ui';

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

export default async function WebhooksPage() {
  const [endpoints, deliveries] = await Promise.all([
    apiGet<WebhookRow[]>('/webhooks'),
    apiGet<DeliveryRow[]>('/webhook-deliveries?limit=25'),
  ]);

  return (
    <main>
      <h1 className="mb-6 text-xl font-semibold">Outbound webhooks</h1>

      <Section title="Subscribe an endpoint">
        <form action={createWebhookAction} className="flex flex-wrap items-center gap-2">
          <input name="url" placeholder="https://example.com/hooks/ai-system" required className={`${inputCls} w-96`} />
          <input name="events" placeholder="events (blank = all), e.g. run.*, gate.requested" className={`${inputCls} w-80`} />
          <input name="description" placeholder="what this is for" className={inputCls} />
          <button type="submit" className={buttonCls}>Add</button>
        </form>
        <p className="mt-2 text-xs text-zinc-500">
          The signing secret is returned once, in the API response. Deliveries carry an HMAC-SHA256
          signature over <code>&quot;&lt;timestamp&gt;.&lt;body&gt;&quot;</code>; verify it before trusting a payload.
        </p>
      </Section>

      <Section title="Endpoints">
        {endpoints.length === 0 ? (
          <p className="text-sm text-zinc-500">No endpoints yet.</p>
        ) : (
          <div className="space-y-3">
            {endpoints.map((endpoint) => (
              <div key={endpoint.id} className="rounded border border-zinc-800 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate font-mono text-sm text-zinc-200">{endpoint.url}</div>
                    <div className="mt-1 text-xs text-zinc-500">
                      {endpoint.events.length > 0 ? endpoint.events.join(', ') : 'all events'}
                      {endpoint.description ? ` — ${endpoint.description}` : ''}
                    </div>
                  </div>
                  <form action={setWebhookActiveAction} className="shrink-0">
                    <input type="hidden" name="endpointId" value={endpoint.id} />
                    <input type="hidden" name="active" value={String(!endpoint.active)} />
                    <button type="submit" className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800">
                      {endpoint.active ? 'Disable' : 'Enable'}
                    </button>
                  </form>
                </div>
                <div className="mt-2 flex gap-4 font-mono text-xs text-zinc-500">
                  <span className={endpoint.active ? 'text-emerald-400' : 'text-zinc-600'}>
                    {endpoint.active ? 'active' : 'disabled'}
                  </span>
                  <span>delivered {endpoint.deliveries.delivered}</span>
                  <span>pending {endpoint.deliveries.pending}</span>
                  <span className={endpoint.deliveries.failed > 0 ? 'text-red-400' : ''}>
                    failed {endpoint.deliveries.failed}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Recent deliveries">
        {deliveries.length === 0 ? (
          <p className="text-sm text-zinc-500">Nothing delivered yet.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase text-zinc-500">
              <tr>
                <th className="py-1">Event</th>
                <th className="py-1">Status</th>
                <th className="py-1">Attempts</th>
                <th className="py-1">Detail</th>
                <th className="py-1" />
              </tr>
            </thead>
            <tbody className="font-mono text-xs text-zinc-300">
              {deliveries.map((delivery) => (
                <tr key={delivery.id} className="border-t border-zinc-900">
                  <td className="py-1">{delivery.eventName}</td>
                  <td className={`py-1 ${delivery.status === 'failed' ? 'text-red-400' : delivery.status === 'delivered' ? 'text-emerald-400' : 'text-amber-400'}`}>
                    {delivery.status}
                  </td>
                  <td className="py-1">{delivery.attempts}</td>
                  <td className="py-1 text-zinc-500">
                    {delivery.lastError ?? (delivery.responseStatus ? `HTTP ${delivery.responseStatus}` : '')}
                  </td>
                  <td className="py-1 text-right">
                    {delivery.status === 'failed' && (
                      <form action={redeliverWebhookAction}>
                        <input type="hidden" name="deliveryId" value={delivery.id} />
                        <button type="submit" className="rounded border border-zinc-700 px-2 py-0.5 text-xs text-zinc-300 hover:bg-zinc-800">
                          Redeliver
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
    </main>
  );
}
