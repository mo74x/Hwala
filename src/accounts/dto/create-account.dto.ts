/* eslint-disable @typescript-eslint/no-unsafe-call */
import { IsUUID, IsNumber, Min, IsOptional, IsNotEmpty } from 'class-validator';
import type { AccountType } from '../../../generated/prisma/client.js';

export class CreateAccountDto {
  @IsUUID('4', { message: 'userId must be a valid UUID' })
  @IsNotEmpty()
  userId: string;

  @IsNotEmpty()
  type: AccountType;

  @IsOptional()
  @IsNumber({}, { message: 'initialBalance must be a number' })
  @Min(0, { message: 'initialBalance cannot be negative' })
  initialBalance?: number;
}
