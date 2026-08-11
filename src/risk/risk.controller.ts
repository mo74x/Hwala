import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import * as riskService_1 from './risk.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentTenant } from '../tenant/tenant.decorator';

export class UpdateRiskFlagStatusDto {
  status: riskService_1.RiskStatus;
}

@Controller('risk')
@UseGuards(JwtAuthGuard)
export class RiskController {
  constructor(private readonly riskService: riskService_1.RiskService) {}

  @Get('flags')
  async getRiskFlags(
    @CurrentTenant() tenantId: string,
    @Query('accountId') accountId?: string,
    @Query('status') status?: riskService_1.RiskStatus,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit?: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset?: number,
  ) {
    return this.riskService.getRiskFlags(tenantId, {
      accountId,
      status,
      limit,
      offset,
    });
  }

  @Patch('flags/:id/status')
  async updateRiskFlagStatus(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateRiskFlagStatusDto,
  ) {
    return this.riskService.updateRiskFlagStatus(tenantId, id, dto.status);
  }
}
