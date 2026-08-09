import type { NextRequest } from 'next/server';
import { apiStreamUrl } from '@/lib/api';

export const dynamic = 'force-dynamic';

/** Proxy the API's SSE stream so the bearer token stays server-side. */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const upstream = await fetch(apiStreamUrl(id), {
    headers: {
      accept: 'text/event-stream',
      ...(process.env.API_TOKEN ? { authorization: `Bearer ${process.env.API_TOKEN}` } : {}),
    },
  });
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    },
  });
}
