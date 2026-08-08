import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { jwtConstants } from './constants';
import { JwtStrategy } from './jwt.strategy';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { ApiKeyGuard } from './api-key.guard';
import { RolesGuard } from './roles.guard';
import { ScopesGuard } from './scopes.guard';

@Module({
  imports: [
    PassportModule,
    JwtModule.register({
      secret: jwtConstants.secret,
      signOptions: { expiresIn: '60m' },
    }),
    ApiKeysModule, // So we can use ApiKeyGuard which depends on ApiKeysService
  ],
  providers: [AuthService, JwtStrategy, ApiKeyGuard, RolesGuard, ScopesGuard],
  exports: [AuthService, ApiKeyGuard, RolesGuard, ScopesGuard],
})
export class AuthModule {}
