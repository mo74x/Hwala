/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-misused-promises */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  BadRequestException,
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { RedisService } from '../../../redis/redis.service';
import { Request, Response } from 'express';
import { Observable, of, throwError } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import * as crypto from 'crypto';

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(private readonly redisService: RedisService) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<any>> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();

    // Only apply idempotency checks to mutating POST requests
    if (request.method !== 'POST') return next.handle();

    const idempotencyKey = request.headers['idempotency-key'] as string;
    if (!idempotencyKey) {
      throw new BadRequestException(
        'Idempotency-Key header is required for this operation',
      );
    }

    // Generate SHA-256 fingerprint of the request path + payload
    const requestHash = crypto
      .createHash('sha256')
      .update(JSON.stringify({ path: request.path, body: request.body || {} }))
      .digest('hex');

    const redis = this.redisService.getClient();
    const cacheKey = `idempotency:${idempotencyKey}`;

    // Attempt atomic lock acquisition with 24h TTL (86400 seconds)
    const inProgressRecord = JSON.stringify({
      status: 'IN_PROGRESS',
      requestHash,
    });

    const acquired = await redis.set(
      cacheKey,
      inProgressRecord,
      'EX',
      86400,
      'NX',
    );

    if (!acquired) {
      // Key already exists in Redis
      const cachedRecordStr = await redis.get(cacheKey);

      if (cachedRecordStr) {
        const parsedRecord = JSON.parse(cachedRecordStr);

        // Verify request payload fingerprint match
        if (
          parsedRecord.requestHash &&
          parsedRecord.requestHash !== requestHash
        ) {
          throw new UnprocessableEntityException(
            'Idempotency-Key payload mismatch: this key was previously used with a different request payload',
          );
        }

        if (parsedRecord.status === 'IN_PROGRESS') {
          throw new ConflictException(
            'A request with this Idempotency-Key is currently processing',
          );
        }

        // Cache Hit: Replay stored response
        response.status(parsedRecord.statusCode || 200);
        response.setHeader('X-Idempotency-Replayed', 'true');
        return of(parsedRecord.body);
      }
    }

    // Execute route handler and update Redis record upon completion
    return next.handle().pipe(
      tap(async (responseBody) => {
        const finalRecord = {
          status: 'COMPLETED',
          requestHash,
          statusCode: response.statusCode || 201,
          body: responseBody,
        };
        await redis.set(cacheKey, JSON.stringify(finalRecord), 'EX', 86400);
      }),
      catchError((err) => {
        // Release IN_PROGRESS lock if the request failed so it can be retried
        redis.del(cacheKey).catch(() => {});
        return throwError(() => err);
      }),
    );
  }
}
