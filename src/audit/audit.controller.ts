import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { AuditService } from './audit.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentTenant } from '../tenant/tenant.decorator';

@Controller('audit')
@UseGuards(JwtAuthGuard)
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get('logs')
  async getAuditLogs(
    @CurrentTenant() tenantId: string,
    @Query('userId') userId?: string,
    @Query('action') action?: string,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit?: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset?: number,
  ) {
    return this.auditService.getAuditLogs(tenantId, {
      userId,
      action,
      limit,
      offset,
    });
  }

  @Get('logs/:id')
  async getAuditLogById(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
  ) {
    return this.auditService.getAuditLogById(tenantId, id);
  }
}
