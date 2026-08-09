import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtStrategy } from './jwt.strategy';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ApiKeyGuard } from './api-key.guard';
import { RolesGuard } from './roles.guard';
import { ScopesGuard } from './scopes.guard';

@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const secret = configService.get<string>('JWT_SECRET');
        if (!secret) {
          throw new Error(
            'FATAL: JWT_SECRET environment variable is missing. Application cannot start securely.',
          );
        }
        return {
          secret,
          signOptions: { expiresIn: '60m' },
        };
      },
    }),
    ApiKeysModule,
    PrismaModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, ApiKeyGuard, RolesGuard, ScopesGuard],
  exports: [AuthService, ApiKeyGuard, RolesGuard, ScopesGuard],
})
export class AuthModule {}
