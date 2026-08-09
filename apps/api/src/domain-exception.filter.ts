import {
  Catch,
  HttpException,
  HttpStatus,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { PermissionDeniedError, QuotaExceededError } from '@ai-system/tenancy';
import { InvalidTaskGraphError } from '@ai-system/orchestration';

/**
 * Domain errors carry their own meaning; without this they surface as 500s,
 * which tells a caller "we broke" when the truth is "you may not do that".
 */
@Catch()
export class DomainExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const reply = host.switchToHttp().getResponse<FastifyReply>();

    if (exception instanceof HttpException) {
      reply.code(exception.getStatus()).send(exception.getResponse());
      return;
    }
    if (exception instanceof PermissionDeniedError) {
      reply.code(HttpStatus.FORBIDDEN).send({
        statusCode: 403,
        message: exception.message,
        permission: exception.permission,
      });
      return;
    }
    if (exception instanceof QuotaExceededError) {
      reply.code(HttpStatus.FORBIDDEN).send({
        statusCode: 403,
        message: exception.message,
        quota: exception.quota,
      });
      return;
    }
    if (exception instanceof InvalidTaskGraphError) {
      reply.code(HttpStatus.BAD_REQUEST).send({ statusCode: 400, message: exception.message });
      return;
    }
    // Genuinely unexpected: log the detail, tell the caller nothing more than 500.
    console.error('unhandled error', exception);
    reply.code(HttpStatus.INTERNAL_SERVER_ERROR).send({
      statusCode: 500,
      message: 'internal server error',
    });
  }
}
