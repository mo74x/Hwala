/* eslint-disable @typescript-eslint/no-unsafe-call */
import {
  IsUUID,
  IsNumber,
  IsPositive,
  IsString,
  IsNotEmpty,
} from 'class-validator';

export class CreateTransferDto {
  @IsUUID('4', { message: 'senderId must be a valid UUID' })
  @IsNotEmpty()
  senderId: string;

  @IsUUID('4', { message: 'receiverId must be a valid UUID' })
  @IsNotEmpty()
  receiverId: string;

  @IsNumber({}, { message: 'amount must be a number' })
  @IsPositive({ message: 'amount must be greater than zero' })
  amount: number;

  @IsString()
  @IsNotEmpty()
  description: string;
}
