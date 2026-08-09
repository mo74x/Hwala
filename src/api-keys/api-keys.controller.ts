/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
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
import { CreateApiKeyDto } from './dto/create-api-key.dto';

@Controller('api-keys')
@UseGuards(JwtAuthGuard)
export class ApiKeysController {
  constructor(private readonly apiKeysService: ApiKeysService) {}

  @Post()
  async createApiKey(
    @CurrentTenant() tenantId: string,
    @Body() dto: CreateApiKeyDto,
  ) {
    return this.apiKeysService.createApiKey(tenantId, dto.name, dto.scopes);
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
