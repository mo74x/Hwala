import {
  Body,
  Controller,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { IdempotencyInterceptor } from 'src/common/interceptors/idempotency/idempotency.interceptor';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { Scopes } from '../auth/scopes.decorator';
import { ScopesGuard } from '../auth/scopes.guard';
import { CurrentTenant } from '../tenant/tenant.decorator';
import { TransferService } from './transfer.service';

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
    @Body('senderId') senderId: string,
    @Body('receiverId') receiverId: string,
    @Body('amount') amount: number,
    @Body('description') description: string,
  ) {
    return this.transferService.executeTransfer(
      tenantId,
      senderId,
      receiverId,
      amount,
      description,
    );
  }
}
