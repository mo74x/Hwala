/* eslint-disable @typescript-eslint/no-unsafe-call */
import {
  IsUUID,
  IsNumber,
  IsPositive,
  IsString,
  IsOptional,
} from 'class-validator';

export class HoldFundsDto {
  @IsUUID('4', { message: 'accountId must be a valid UUID' })
  accountId: string;

  @IsNumber({}, { message: 'amount must be a number' })
  @IsPositive({ message: 'amount must be greater than zero' })
  amount: number;

  @IsString()
  @IsOptional()
  description?: string;
}
