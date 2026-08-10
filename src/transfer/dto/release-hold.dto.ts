/* eslint-disable @typescript-eslint/no-unsafe-call */
import {
  IsUUID,
  IsNumber,
  IsPositive,
  IsString,
  IsOptional,
} from 'class-validator';

export class ReleaseHoldDto {
  @IsUUID('4', { message: 'holdId must be a valid UUID' })
  holdId: string;

  @IsNumber({}, { message: 'amount must be a number' })
  @IsPositive({ message: 'amount must be greater than zero' })
  amount: number;

  @IsString()
  @IsOptional()
  description?: string;
}
