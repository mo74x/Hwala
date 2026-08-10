/* eslint-disable @typescript-eslint/no-unsafe-call */
import {
  IsUUID,
  IsNumber,
  IsPositive,
  IsString,
  IsOptional,
} from 'class-validator';

export class CaptureHoldDto {
  @IsUUID('4', { message: 'holdId must be a valid UUID' })
  holdId: string;

  @IsUUID('4', { message: 'receiverId must be a valid UUID' })
  receiverId: string;

  @IsNumber({}, { message: 'amount must be a number' })
  @IsPositive({ message: 'amount must be greater than zero' })
  amount: number;

  @IsString()
  @IsOptional()
  description?: string;
}
