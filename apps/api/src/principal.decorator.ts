import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Principal } from '@ai-system/tenancy';
import type { RequestWithPrincipal } from './auth.js';

/** Injects the authenticated principal; the guard guarantees it is present. */
export const CurrentPrincipal = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Principal => {
    const req = context.switchToHttp().getRequest<RequestWithPrincipal>();
    return req.principal!;
  },
);
