/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { OutboxProcessor } from './outbox.processor';
import { PrismaService } from '../prisma/prisma.service';

describe('OutboxProcessor', () => {
  let processor: OutboxProcessor;
  let module: TestingModule;

  const mockPrismaService = {
    webhookOutbox: {
      findMany: jest.fn(),
      update: jest.fn(),
    },
    webhookFailure: {
      create: jest.fn(),
    },
  };

  const mockQueue = {
    add: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    module = await Test.createTestingModule({
      providers: [
        OutboxProcessor,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: getQueueToken('webhook_queue'), useValue: mockQueue },
      ],
    }).compile();

    processor = module.get<OutboxProcessor>(OutboxProcessor);
  });

  afterEach(async () => {
    if (module) {
      await module.close();
    }
  });

  it('should be defined', () => {
    expect(processor).toBeDefined();
  });

  describe('processPendingOutbox', () => {
    it('should do nothing if no PENDING entries exist', async () => {
      mockPrismaService.webhookOutbox.findMany.mockResolvedValue([]);

      await processor.processPendingOutbox();

      expect(mockPrismaService.webhookOutbox.findMany).toHaveBeenCalledWith({
        where: { status: 'PENDING' },
        take: 50,
        orderBy: { createdAt: 'asc' },
      });
      expect(mockQueue.add).not.toHaveBeenCalled();
    });

    it('should process PENDING outbox entry, push to queue, and update status to COMPLETED', async () => {
      const mockOutboxEntry = {
        id: 'outbox-123',
        tenantId: 'tenant-123',
        eventType: 'transfer.completed',
        payload: { amount: 100 },
        attempts: 0,
        status: 'PENDING',
      };

      mockPrismaService.webhookOutbox.findMany.mockResolvedValue([
        mockOutboxEntry,
      ]);
      mockPrismaService.webhookOutbox.update.mockResolvedValue({});
      mockQueue.add.mockResolvedValue({});

      await processor.processPendingOutbox();

      expect(mockPrismaService.webhookOutbox.update).toHaveBeenCalledWith({
        where: { id: 'outbox-123' },
        data: { status: 'PROCESSING', attempts: { increment: 1 } },
      });

      expect(mockQueue.add).toHaveBeenCalledWith(
        'transfer.completed',
        { amount: 100 },
        expect.any(Object),
      );

      expect(mockPrismaService.webhookOutbox.update).toHaveBeenCalledWith({
        where: { id: 'outbox-123' },
        data: { status: 'COMPLETED' },
      });
    });

    it('should move outbox entry to WebhookFailure DLQ when attempts reach max limit', async () => {
      const mockOutboxEntry = {
        id: 'outbox-failed-max',
        tenantId: 'tenant-123',
        eventType: 'transfer.completed',
        payload: { amount: 200 },
        attempts: 4, // 4 + 1 = 5 (maxAttempts)
        status: 'PENDING',
      };

      mockPrismaService.webhookOutbox.findMany.mockResolvedValue([
        mockOutboxEntry,
      ]);
      mockPrismaService.webhookOutbox.update.mockResolvedValue({});
      mockQueue.add.mockRejectedValue(new Error('Queue Error'));

      await processor.processPendingOutbox();

      expect(mockPrismaService.webhookOutbox.update).toHaveBeenCalledWith({
        where: { id: 'outbox-failed-max' },
        data: { status: 'FAILED' },
      });

      expect(mockPrismaService.webhookFailure.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId: 'tenant-123',
          eventType: 'transfer.completed',
          error: 'Queue Error',
          retries: 5,
        }),
      });
    });
  });
});
