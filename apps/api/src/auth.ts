import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { Db } from '@ai-system/db';
import {
  RateLimiter,
  getQuotas,
  resolveApiKey,
  type Principal,
} from '@ai-system/tenancy';
import { DB } from './db.provider.js';

export type RequestWithPrincipal = FastifyRequest & { principal?: Principal };

const PUBLIC_PATHS = ['/api/health'];
const DEFAULT_RATE_LIMIT = Number(process.env.RATE_LIMIT_PER_MINUTE ?? 120);

/**
 * Every request is attributed to a principal, and the principal carries the
 * organization that scopes all subsequent queries. There is no ambient
 * "current org" — multi-tenancy that depends on remembering to filter is
 * multi-tenancy that leaks.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  private readonly limiter = new RateLimiter(DEFAULT_RATE_LIMIT);

  constructor(@Inject(DB) private readonly db: Db) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<RequestWithPrincipal>();
    if (PUBLIC_PATHS.some((p) => req.url.startsWith(p))) return true;

    // The Jira webhook authenticates with its own shared secret and runs as a
    // dedicated principal, so it never borrows a user's rights.
    if (req.url.startsWith('/api/webhooks/jira')) {
      const secret = process.env.JIRA_WEBHOOK_SECRET;
      const provided = new URL(req.url, 'http://localhost').searchParams.get('secret');
      if (!secret || provided !== secret) throw new UnauthorizedException('invalid webhook secret');
      const principal = await webhookPrincipal(this.db);
      if (!principal) throw new UnauthorizedException('webhook organization not configured');
      req.principal = principal;
      return true;
    }

    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw new UnauthorizedException('missing bearer token');

    const principal = await resolveApiKey(this.db, token);
    if (!principal) throw new UnauthorizedException('invalid or revoked API key');

    const quotas = await getQuotas(this.db, principal.organizationId);
    if (!this.limiter.take(principal.organizationId, quotas.requestsPerMinute ?? DEFAULT_RATE_LIMIT)) {
      throw new ForbiddenException('rate limit exceeded');
    }

    req.principal = principal;
    return true;
  }
}

/** The webhook acts as a `member` of the organization named by JIRA_WEBHOOK_ORG_ID. */
async function webhookPrincipal(db: Db): Promise<Principal | null> {
  const organizationId = process.env.JIRA_WEBHOOK_ORG_ID;
  if (!organizationId) return null;
  const { organizations } = await import('@ai-system/db');
  const { eq } = await import('drizzle-orm');
  const rows = await db.select().from(organizations).where(eq(organizations.id, organizationId));
  if (!rows[0]) return null;
  return {
    kind: 'api_key',
    organizationId,
    userId: null,
    role: 'member',
    label: 'jira-webhook',
  };
}
