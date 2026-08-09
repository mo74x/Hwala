import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { TransferService } from './transfer.service';
import { PrismaService } from '../prisma/prisma.service';
import { SecurityService } from '../security/security.service';

describe('TransferService', () => {
  let service: TransferService;

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
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TransferService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: getQueueToken('webhook_queue'), useValue: mockQueue },
        { provide: SecurityService, useValue: mockSecurityService },
      ],
    }).compile();

    service = module.get<TransferService>(TransferService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
