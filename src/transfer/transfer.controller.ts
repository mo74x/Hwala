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
}
