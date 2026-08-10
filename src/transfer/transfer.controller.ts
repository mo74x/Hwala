import {
  Body,
  Controller,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { IdempotencyInterceptor } from '../common/interceptors/idempotency/idempotency.interceptor';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { Scopes } from '../auth/scopes.decorator';
import { ScopesGuard } from '../auth/scopes.guard';
import { CurrentTenant } from '../tenant/tenant.decorator';
import { TransferService } from './transfer.service';
import { CreateTransferDto } from './dto/create-transfer.dto';
import { HoldFundsDto } from './dto/hold-funds.dto';
import { CaptureHoldDto } from './dto/capture-hold.dto';
import { ReleaseHoldDto } from './dto/release-hold.dto';

@Controller('api/v1/transfers')
@UseGuards(ApiKeyGuard, ScopesGuard)
export class TransferController {
  constructor(private readonly transferService: TransferService) {}

  @Post()
  @Scopes('write:transfers')
  //Protects against network retries
  @UseInterceptors(IdempotencyInterceptor)
  async createTransfer(
    @CurrentTenant() tenantId: string,
    @Body() dto: CreateTransferDto,
  ) {
    return this.transferService.executeTransfer(
      tenantId,
      dto.senderId,
      dto.receiverId,
      dto.amount,
      dto.description,
    );
  }

  // ── Hold / Escrow Endpoints ──────────────────────────────────

  @Post('holds')
  @Scopes('write:transfers')
  @UseInterceptors(IdempotencyInterceptor)
  async holdFunds(
    @CurrentTenant() tenantId: string,
    @Body() dto: HoldFundsDto,
  ) {
    return this.transferService.holdFunds(
      tenantId,
      dto.accountId,
      dto.amount,
      dto.description || 'Funds held',
    );
  }

  @Post('holds/capture')
  @Scopes('write:transfers')
  @UseInterceptors(IdempotencyInterceptor)
  async captureHold(
    @CurrentTenant() tenantId: string,
    @Body() dto: CaptureHoldDto,
  ) {
    return this.transferService.captureHold(
      tenantId,
      dto.holdId,
      dto.receiverId,
      dto.amount,
      dto.description || 'Hold captured',
    );
  }

  @Post('holds/release')
  @Scopes('write:transfers')
  @UseInterceptors(IdempotencyInterceptor)
  async releaseHold(
    @CurrentTenant() tenantId: string,
    @Body() dto: ReleaseHoldDto,
  ) {
    return this.transferService.releaseHold(
      tenantId,
      dto.holdId,
      dto.amount,
      dto.description || 'Hold released',
    );
  }
}
