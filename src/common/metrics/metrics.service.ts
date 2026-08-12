import { Injectable } from '@nestjs/common';

export interface HttpRequestMetric {
  method: string;
  route: string;
  statusCode: number;
  durationMs: number;
}

@Injectable()
export class MetricsService {
  private httpRequestsTotal = new Map<string, number>();
  private httpRequestDurationSum = new Map<string, number>();
  private httpRequestDurationCount = new Map<string, number>();
  private transfersTotal = new Map<string, number>();

  recordHttpRequest(metric: HttpRequestMetric): void {
    const key = `method="${metric.method}",route="${metric.route}",status="${metric.statusCode}"`;
    const countKey = `method="${metric.method}",route="${metric.route}"`;

    this.httpRequestsTotal.set(key, (this.httpRequestsTotal.get(key) || 0) + 1);
    this.httpRequestDurationSum.set(
      countKey,
      (this.httpRequestDurationSum.get(countKey) || 0) +
        metric.durationMs / 1000,
    );
    this.httpRequestDurationCount.set(
      countKey,
      (this.httpRequestDurationCount.get(countKey) || 0) + 1,
    );
  }

  recordTransfer(tenantId: string, status: string): void {
    const key = `tenant="${tenantId}",status="${status}"`;
    this.transfersTotal.set(key, (this.transfersTotal.get(key) || 0) + 1);
  }

  getMetrics(): string {
    const lines: string[] = [];

    // System Metrics
    const memUsage = process.memoryUsage();
    lines.push(
      '# HELP process_resident_memory_bytes Resident memory size in bytes.',
    );
    lines.push('# TYPE process_resident_memory_bytes gauge');
    lines.push(`process_resident_memory_bytes ${memUsage.rss}`);

    lines.push('# HELP process_heap_bytes Process heap memory usage in bytes.');
    lines.push('# TYPE process_heap_bytes gauge');
    lines.push(`process_heap_bytes ${memUsage.heapUsed}`);

    lines.push('# HELP process_uptime_seconds Process uptime in seconds.');
    lines.push('# TYPE process_uptime_seconds counter');
    lines.push(`process_uptime_seconds ${Math.floor(process.uptime())}`);

    // HTTP Requests Total
    lines.push(
      '# HELP nestjs_http_requests_total Total number of HTTP requests processed.',
    );
    lines.push('# TYPE nestjs_http_requests_total counter');
    for (const [labels, count] of this.httpRequestsTotal.entries()) {
      lines.push(`nestjs_http_requests_total{${labels}} ${count}`);
    }

    // HTTP Request Duration
    lines.push(
      '# HELP nestjs_http_request_duration_seconds_sum Total duration of HTTP requests in seconds.',
    );
    lines.push('# TYPE nestjs_http_request_duration_seconds_sum counter');
    for (const [labels, sum] of this.httpRequestDurationSum.entries()) {
      lines.push(
        `nestjs_http_request_duration_seconds_sum{${labels}} ${sum.toFixed(4)}`,
      );
    }

    lines.push(
      '# HELP nestjs_http_request_duration_seconds_count Total count of HTTP requests measured.',
    );
    lines.push('# TYPE nestjs_http_request_duration_seconds_count counter');
    for (const [labels, count] of this.httpRequestDurationCount.entries()) {
      lines.push(
        `nestjs_http_request_duration_seconds_count{${labels}} ${count}`,
      );
    }

    // Business Metrics — Transfers
    lines.push(
      '# HELP hwala_transfers_total Total financial transfers executed.',
    );
    lines.push('# TYPE hwala_transfers_total counter');
    for (const [labels, count] of this.transfersTotal.entries()) {
      lines.push(`hwala_transfers_total{${labels}} ${count}`);
    }

    return lines.join('\n') + '\n';
  }
}
