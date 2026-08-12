/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { MetricsService } from './metrics.service';

@Injectable()
export class MetricsMiddleware implements NestMiddleware {
  constructor(private readonly metricsService: MetricsService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const startTime = Date.now();
    const requestId =
      (req.headers['x-request-id'] as string) ||
      `req-${Math.random().toString(36).substring(2, 9)}`;

    res.setHeader('x-request-id', requestId);

    res.on('finish', () => {
      const durationMs = Date.now() - startTime;
      const route = req.route ? (req.route.path as string) : req.path;

      if (route !== '/metrics' && route !== '/health') {
        this.metricsService.recordHttpRequest({
          method: req.method,
          route,
          statusCode: res.statusCode,
          durationMs,
        });
      }
    });

    next();
  }
}
