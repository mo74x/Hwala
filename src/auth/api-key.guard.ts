/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiKeysService } from '../api-keys/api-keys.service';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly apiKeysService: ApiKeysService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const apiKey = request.headers['x-api-key'];

    if (!apiKey) {
      throw new UnauthorizedException('API key is missing');
    }

    // This service method will validate the key and return the associated tenant information
    const keyData = await this.apiKeysService.validateApiKey(apiKey);

    if (!keyData) {
      throw new UnauthorizedException('Invalid API key');
    }

    // Attach the "user" object (representing the API key identity) so the rest of the app can use @CurrentTenant()
    request.user = {
      tenantId: keyData.tenantId,
      role: 'API_USER', // Or based on scopes
      apiKeyId: keyData.id,
      scopes: keyData.scopes,
    };

    return true;
  }
}
