/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/require-await */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { BadRequestException } from '@nestjs/common';
import { TransferService } from './transfer.service';
import { PrismaService } from '../prisma/prisma.service';
import { SecurityService } from '../security/security.service';

describe('TransferService', () => {
  let service: TransferService;
  let module: TestingModule;

  const mockPrismaService = {
    $transaction: jest.fn(),
  };

  const mockQueue = {
    add: jest.fn(),
  };

  const mockSecurityService = {
    enforceTransferVelocity: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    module = await Test.createTestingModule({
      providers: [
        TransferService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: getQueueToken('webhook_queue'), useValue: mockQueue },
        { provide: SecurityService, useValue: mockSecurityService },
      ],
    }).compile();

    service = module.get<TransferService>(TransferService);
  });

  afterEach(async () => {
    if (module) {
      await module.close();
    }
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('executeTransfer - Fee Engine & Transactional Outbox', () => {
    const tenantId = '11111111-1111-1111-1111-111111111111';
    const senderId = '22222222-2222-2222-2222-222222222222';
    const receiverId = '33333333-3333-3333-3333-333333333333';
    const revenueAccountId = '44444444-4444-4444-4444-444444444444';
    const userId = '55555555-5555-5555-5555-555555555555';

    it('should execute transfer with 0 platform fee and write transfer.completed to WebhookOutbox', async () => {
      const mockTx = {
        tenant: {
          findUnique: jest.fn().mockResolvedValue({
            id: tenantId,
            feeFixed: 0,
            feePercentage: 0,
          }),
        },
        account: {
          findUnique: jest.fn().mockImplementation(({ where }) => {
            if (where.id === senderId) {
              return Promise.resolve({
                id: senderId,
                tenantId,
                balance: 500,
                userId,
                currency: 'USD',
              });
            }
            if (where.id === receiverId) {
              return Promise.resolve({
                id: receiverId,
                tenantId,
                balance: 100,
                userId,
                currency: 'USD',
              });
            }
            return Promise.resolve(null);
          }),
          update: jest.fn().mockResolvedValue({}),
        },
        $queryRaw: jest.fn().mockResolvedValue([]),
        ledgerEntry: {
          createMany: jest.fn().mockResolvedValue({ count: 2 }),
        },
        webhookOutbox: {
          create: jest.fn().mockResolvedValue({}),
        },
      };

      mockPrismaService.$transaction.mockImplementation(async (cb) =>
        cb(mockTx),
      );

      const result = await service.executeTransfer(
        tenantId,
        senderId,
        receiverId,
        100,
        'Test transfer zero fee',
      );

      expect(result.status).toBe('SUCCESS');
      expect(result.fee).toBe(0);
      expect(mockTx.webhookOutbox.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId,
          eventType: 'transfer.completed',
          status: 'PENDING',
          payload: expect.objectContaining({
            tenantId,
            senderId,
            receiverId,
            amount: 100,
            fee: 0,
          }),
        }),
      });
    });

    it('should calculate fixed + percentage fee and route to PLATFORM_REVENUE account', async () => {
      const mockTx = {
        tenant: {
          findUnique: jest.fn().mockResolvedValue({
            id: tenantId,
            feeFixed: 2.0,
            feePercentage: 0.01,
          }),
        },
        account: {
          findFirst: jest.fn().mockResolvedValue({
            id: revenueAccountId,
            tenantId,
            type: 'PLATFORM_REVENUE',
          }),
          findUnique: jest.fn().mockImplementation(({ where }) => {
            if (where.id === senderId) {
              return Promise.resolve({
                id: senderId,
                tenantId,
                balance: 500,
                userId,
                currency: 'USD',
              });
            }
            if (where.id === receiverId) {
              return Promise.resolve({
                id: receiverId,
                tenantId,
                balance: 100,
                userId,
                currency: 'USD',
              });
            }
            return Promise.resolve(null);
          }),
          update: jest.fn().mockResolvedValue({}),
        },
        $queryRaw: jest.fn().mockResolvedValue([]),
        ledgerEntry: {
          createMany: jest.fn().mockResolvedValue({ count: 4 }),
        },
        webhookOutbox: {
          create: jest.fn().mockResolvedValue({}),
        },
      };

      mockPrismaService.$transaction.mockImplementation(async (cb) =>
        cb(mockTx),
      );

      const result = await service.executeTransfer(
        tenantId,
        senderId,
        receiverId,
        100,
        'Test transfer with fee',
      );

      expect(result.status).toBe('SUCCESS');
      expect(result.fee).toBe(3.0);
      expect(mockTx.webhookOutbox.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId,
          eventType: 'transfer.completed',
          status: 'PENDING',
          payload: expect.objectContaining({
            fee: 3.0,
          }),
        }),
      });
    });

    it('should throw BadRequestException if sender balance is less than transfer amount + fee', async () => {
      const mockTx = {
        tenant: {
          findUnique: jest.fn().mockResolvedValue({
            id: tenantId,
            feeFixed: 5.0,
            feePercentage: 0.05,
          }),
        },
        account: {
          findFirst: jest.fn().mockResolvedValue({
            id: revenueAccountId,
            tenantId,
            type: 'PLATFORM_REVENUE',
          }),
          findUnique: jest.fn().mockImplementation(({ where }) => {
            if (where.id === senderId) {
              return Promise.resolve({
                id: senderId,
                tenantId,
                balance: 105,
                userId,
                currency: 'USD',
              });
            }
            if (where.id === receiverId) {
              return Promise.resolve({
                id: receiverId,
                tenantId,
                balance: 50,
                userId,
                currency: 'USD',
              });
            }
            return Promise.resolve(null);
          }),
          update: jest.fn(),
        },
        $queryRaw: jest.fn().mockResolvedValue([]),
        ledgerEntry: {
          createMany: jest.fn(),
        },
        webhookOutbox: {
          create: jest.fn(),
        },
      };

      mockPrismaService.$transaction.mockImplementation(async (cb) =>
        cb(mockTx),
      );

      await expect(
        service.executeTransfer(
          tenantId,
          senderId,
          receiverId,
          100,
          'Fee test',
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
