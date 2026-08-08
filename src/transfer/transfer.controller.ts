/* eslint-disable @typescript-eslint/no-unsafe-return */
import { Body, Controller, Post, UseInterceptors } from '@nestjs/common';
import { IdempotencyInterceptor } from 'src/common/interceptors/idempotency/idempotency.interceptor';
import { CurrentTenant } from '../tenant/tenant.decorator';
import { TransferService } from './transfer.service';

@Controller('api/v1/transfers')
export class TransferController {
  constructor(private readonly transferService: TransferService) {}

  @Post()
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
