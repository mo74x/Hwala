/* eslint-disable @typescript-eslint/no-unsafe-call */
import {
  IsUUID,
  IsEmail,
  IsString,
  IsNotEmpty,
  MinLength,
  IsOptional,
} from 'class-validator';
import type { Role } from '../../../generated/prisma/client.js';

export class RegisterUserDto {
  @IsUUID('4', { message: 'tenantId must be a valid UUID' })
  @IsNotEmpty()
  tenantId: string;

  @IsEmail({}, { message: 'Please provide a valid email address' })
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(6, { message: 'Password must be at least 6 characters long' })
  password: string;

  @IsOptional()
  role?: Role;
}
