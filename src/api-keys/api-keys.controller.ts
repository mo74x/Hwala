/* eslint-disable @typescript-eslint/no-unsafe-return */

import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiKeysService } from './api-keys.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentTenant } from '../tenant/tenant.decorator';

@Controller('api-keys')
@UseGuards(JwtAuthGuard)
export class ApiKeysController {
  constructor(private readonly apiKeysService: ApiKeysService) {}

  @Post()
  async createApiKey(
    @CurrentTenant() tenantId: string,
    @Body('name') name: string,
    @Body('scopes') scopes?: string[],
  ) {
    return this.apiKeysService.createApiKey(tenantId, name, scopes);
  }

  @Get()
  listApiKeys(@CurrentTenant() tenantId: string) {
    return this.apiKeysService.listApiKeys(tenantId);
  }

  @Delete(':id')
  async revokeApiKey(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
  ) {
    return this.apiKeysService.revokeApiKey(tenantId, id);
  }
}
