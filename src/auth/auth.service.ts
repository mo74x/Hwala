/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { User } from '../../generated/prisma/client.js';

@Injectable()
export class AuthService {
  constructor(private jwtService: JwtService) {}

  /**
   * Generates a JWT token for the authenticated user.
   */
  login(user: Omit<User, 'passwordHash'>) {
    const payload = {
      email: user.email,
      sub: user.id,
      tenantId: user.tenantId,
      role: user.role,
    };

    return {
      access_token: this.jwtService.sign(payload),
    };
  }
}
