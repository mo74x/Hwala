/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';

@Injectable()
export class ApiKeysService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Generates a new API Key for a tenant.
   * Returns the raw key (to be shown to the user ONCE) and stores the hash in the DB.
   */
  async createApiKey(tenantId: string, name: string, scopes: string[] = []) {
    // Generate a secure random secret
    const secret = crypto.randomBytes(32).toString('hex');

    // We need the ID first to construct the full key, so we generate a UUID manually
    const id = crypto.randomUUID();
    const rawKey = `hwl_${id}_${secret}`;

    // Hash it before storing
    const keyHash = await bcrypt.hash(rawKey, 10);

    const apiKey = await this.prisma.apiKey.create({
      data: {
        id, // pass the generated ID
        tenantId,
        name,
        keyHash,
        scopes,
      },
    });

    return {
      apiKey: rawKey,
      id: apiKey.id,
      name: apiKey.name,
      scopes: apiKey.scopes,
    };
  }

  async validateApiKey(rawKey: string) {
    const parts = rawKey.split('_');

    if (parts.length < 3) {
      return null;
    }

    const prefix = parts[0]; // hwl
    const id = parts[1];
    const secret = parts[2];

    const apiKeyRecord = await this.prisma.apiKey.findUnique({
      where: { id },
    });

    if (!apiKeyRecord) {
      return null;
    }

    const isMatch = await bcrypt.compare(
      `${prefix}_${id}_${secret}`,
      apiKeyRecord.keyHash,
    );
    if (isMatch) {
      return apiKeyRecord;
    }

    return null;
  }

  /**
   * Lists all active API Keys for a given tenant, omitting secret hashes.
   */
  listApiKeys(tenantId: string) {
    return this.prisma.apiKey.findMany({
      where: { tenantId },
      select: {
        id: true,
        tenantId: true,
        name: true,
        scopes: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  /**
   * Revokes (deletes) an API Key by ID for a given tenant.
   */
  async revokeApiKey(tenantId: string, id: string) {
    const apiKeyRecord = await this.prisma.apiKey.findFirst({
      where: { id, tenantId },
    });

    if (!apiKeyRecord) {
      throw new NotFoundException('API Key not found');
    }

    await this.prisma.apiKey.delete({
      where: { id },
    });

    return { message: 'API key revoked successfully', id };
  }
}
