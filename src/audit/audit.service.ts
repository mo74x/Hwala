/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface LogAuditParams {
  tenantId: string;
  userId?: string;
  action: string;
  targetId?: string;
  metadata?: Record<string, any>;
}

export interface QueryAuditLogsOptions {
  userId?: string;
  action?: string;
  limit?: number;
  offset?: number;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Appends an immutable audit log entry to the AuditLog table.
   */
  async log(params: LogAuditParams) {
    const { tenantId, userId, action, targetId, metadata } = params;

    return this.prisma.auditLog.create({
      data: {
        tenantId,
        userId: userId || null,
        action,
        targetId: targetId || null,
        metadata: metadata ? (metadata as any) : undefined,
      },
    });
  }

  /**
   * Retrieves audit logs for a given tenant with optional filtering and pagination.
   */
  async getAuditLogs(tenantId: string, options?: QueryAuditLogsOptions) {
    const { userId, action, limit = 50, offset = 0 } = options || {};

    const where: any = { tenantId };
    if (userId) where.userId = userId;
    if (action) where.action = action;

    const [logs, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return {
      data: logs,
      total,
      limit,
      offset,
    };
  }

  /**
   * Retrieves a single audit log entry by ID for a specific tenant.
   */
  async getAuditLogById(tenantId: string, id: string) {
    const log = await this.prisma.auditLog.findFirst({
      where: { id, tenantId },
    });

    if (!log) {
      throw new NotFoundException(`Audit log entry with ID ${id} not found`);
    }

    return log;
  }
}
