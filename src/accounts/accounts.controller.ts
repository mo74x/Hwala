import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AccountsService } from './accounts.service';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { Scopes } from '../auth/scopes.decorator';
import { ScopesGuard } from '../auth/scopes.guard';
import { CurrentTenant } from '../tenant/tenant.decorator';
import type { AccountType } from '../../generated/prisma/client.js';

@Controller('accounts')
@UseGuards(ApiKeyGuard, ScopesGuard)
export class AccountsController {
  constructor(private readonly accountsService: AccountsService) {}

  @Post()
  @Scopes('write:accounts')
  async createAccount(
    @CurrentTenant() tenantId: string,
    @Body('userId') userId: string,
    @Body('type') type: AccountType,
    @Body('initialBalance') initialBalance?: number,
  ) {
    return this.accountsService.createAccount(
      tenantId,
      userId,
      type,
      initialBalance,
    );
  }

  @Get()
  @Scopes('read:accounts')
  async listAccounts(@CurrentTenant() tenantId: string) {
    return this.accountsService.listAccounts(tenantId);
  }

  @Get('reconcile')
  @Scopes('read:accounts')
  async reconcileBalance(@CurrentTenant() tenantId: string) {
    return this.accountsService.reconcileTenantBalance(tenantId);
  }

  @Get(':id/ledger')
  @Scopes('read:accounts')
  async getAccountLedger(
    @CurrentTenant() tenantId: string,
    @Param('id') accountId: string,
  ) {
    return this.accountsService.getAccountLedger(tenantId, accountId);
  }
}
