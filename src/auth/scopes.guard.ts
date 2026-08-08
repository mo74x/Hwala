/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SCOPES_KEY } from './scopes.decorator';

@Injectable()
export class ScopesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredScopes = this.reflector.getAllAndOverride<string[]>(
      SCOPES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredScopes || requiredScopes.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user || !user.scopes || !Array.isArray(user.scopes)) {
      throw new ForbiddenException('No scopes attached to request context');
    }

    const hasAllScopes = requiredScopes.every((requiredScope) =>
      user.scopes.includes(requiredScope),
    );

    if (!hasAllScopes) {
      throw new ForbiddenException(
        `Insufficient API Key scopes. Required: ${requiredScopes.join(', ')}`,
      );
    }

    return true;
  }
}
