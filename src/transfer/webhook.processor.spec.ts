/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Test, TestingModule } from '@nestjs/testing';
import { WebhookProcessor } from './webhook.processor';
import { PrismaService } from '../prisma/prisma.service';
import { Job } from 'bullmq';
import * as crypto from 'crypto';

describe('WebhookProcessor', () => {
  let processor: WebhookProcessor;
  let prismaService: {
    tenant: {
      findUnique: jest.Mock;
    };
  };

  beforeEach(async () => {
    prismaService = {
      tenant: {
        findUnique: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhookProcessor,
        { provide: PrismaService, useValue: prismaService },
      ],
    }).compile();

    processor = module.get<WebhookProcessor>(WebhookProcessor);

    // Disable random network failure for test stability
    jest.spyOn(Math, 'random').mockReturnValue(0.9);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should be defined', () => {
    expect(processor).toBeDefined();
  });

  it('should compute X-Signature with tenant webhookSecret when present', async () => {
    const tenantSecret = 'custom-tenant-secret-123';
    prismaService.tenant.findUnique.mockResolvedValue({
      webhookSecret: tenantSecret,
    });

    const jobData = {
      tenantId: '11111111-1111-1111-1111-111111111111',
      transactionId: 'tx-001',
      amount: 100,
    };
    const job = { attemptsMade: 0, data: jobData } as Job;

    const payloadString = JSON.stringify(jobData);
    const expectedHmac = crypto
      .createHmac('sha256', tenantSecret)
      .update(payloadString)
      .digest('hex');
    const expectedSignature = `sha256=${expectedHmac}`;

    const result = await processor.process(job);

    expect(prismaService.tenant.findUnique).toHaveBeenCalledWith({
      where: { id: jobData.tenantId },
      select: { webhookSecret: true },
    });
    expect(result.delivered).toBe(true);
    expect(result.signature).toBe(expectedSignature);
  });

  it('should fallback to default secret when tenant has no webhookSecret', async () => {
    prismaService.tenant.findUnique.mockResolvedValue({
      webhookSecret: null,
    });

    const jobData = {
      tenantId: '22222222-2222-2222-2222-222222222222',
      transactionId: 'tx-002',
      amount: 500,
    };
    const job = { attemptsMade: 0, data: jobData } as Job;

    const payloadString = JSON.stringify(jobData);
    const expectedHmac = crypto
      .createHmac('sha256', 'super-secret-merchant-key')
      .update(payloadString)
      .digest('hex');
    const expectedSignature = `sha256=${expectedHmac}`;

    const result = await processor.process(job);

    expect(result.delivered).toBe(true);
    expect(result.signature).toBe(expectedSignature);
  });
});
