import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { TransactionService } from './transaction.service';
import { PrismaService } from '../../prisma/prisma.service';
import { DEFAULT_REDIS_NAMESPACE, getRedisToken } from '@songkeys/nestjs-redis';
import { Redis } from 'ioredis';
import { TransactionType, TransactionStatus } from '@prisma/client';

// Mock Redis
const mockRedis = {
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
};

// Mock types for better type safety
type MockPrismaService = {
  wallet: {
    findUnique: jest.Mock;
  };
  transaction: {
    findMany: jest.Mock;
    findUnique: jest.Mock;
    count: jest.Mock;
    groupBy: jest.Mock;
  };
};

type MockRedisService = {
  get: jest.Mock;
  set: jest.Mock;
};

describe('TransactionService', () => {
  let service: TransactionService;
  let prismaService: MockPrismaService;
  let redis: Redis;

  const mockWallet = {
    id: 'wallet-123',
    userId: 'user-123',
    balance: '1000.00',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockTransaction = {
    id: 'tx-123',
    transactionId: 'tx-id-123',
    walletId: 'wallet-123',
    destinationWalletId: 'wallet-456',
    type: TransactionType.TRANSFER_OUT,
    status: TransactionStatus.COMPLETED,
    amount: '100.00',
    description: 'Test transfer',
    createdAt: new Date(),
    updatedAt: new Date(),
    wallet: {
      userId: 'user-123',
    },
    destinationWallet: {
      userId: 'user-456',
    },
  };

  beforeEach(async () => {
    const mockPrismaService: MockPrismaService = {
      wallet: {
        findUnique: jest.fn(),
      },
      transaction: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        count: jest.fn(),
        groupBy: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TransactionService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: getRedisToken(DEFAULT_REDIS_NAMESPACE),
          useValue: mockRedis,
        },
      ],
    }).compile();

    service = module.get<TransactionService>(TransactionService);
    prismaService = module.get<MockPrismaService>(PrismaService);
    redis = module.get<Redis>(getRedisToken(DEFAULT_REDIS_NAMESPACE));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getTransactions', () => {
    const getTransactionsDto = {
      walletId: 'wallet-123',
      page: 1,
      perPage: 10,
    };

    it('should return transactions with pagination metadata', async () => {
      const mockTransactions = [mockTransaction];
      const mockCount = 1;
      const expectedResult = {
        data: mockTransactions,
        meta: {
          total: mockCount,
          page: 1,
          perPage: 10,
          totalPages: 1,
        },
      };

      prismaService.wallet.findUnique.mockResolvedValue(mockWallet);
      mockRedis.get.mockResolvedValue(null);
      prismaService.transaction.count.mockResolvedValue(mockCount);
      prismaService.transaction.findMany.mockResolvedValue(mockTransactions);
      mockRedis.set.mockResolvedValue('OK');

      const result = await service.getTransactions(getTransactionsDto);

      expect(result).toEqual(expectedResult);
      expect(prismaService.wallet.findUnique).toHaveBeenCalledWith({
        where: { id: 'wallet-123' },
      });
      expect(prismaService.transaction.findMany).toHaveBeenCalledWith({
        where: { walletId: 'wallet-123' },
        orderBy: { createdAt: 'desc' },
        skip: 0,
        take: 10,
        include: {
          wallet: { select: { userId: true } },
          destinationWallet: { select: { userId: true } },
        },
      });
    });

    it('should throw NotFoundException when wallet does not exist', async () => {
      prismaService.wallet.findUnique.mockResolvedValue(null);

      await expect(service.getTransactions(getTransactionsDto)).rejects.toThrow(
        new NotFoundException('Wallet not found'),
      );
    });

    it('should return cached result when available', async () => {

      const cachedResult = {
        data: [
          {
            ...mockTransaction,
            createdAt: mockTransaction.createdAt.toISOString(),
            updatedAt: mockTransaction.updatedAt.toISOString(),
          },
        ],
        meta: { total: 1, page: 1, perPage: 10, totalPages: 1 },
      };

      prismaService.wallet.findUnique.mockResolvedValue(mockWallet);
      mockRedis.get.mockResolvedValue(JSON.stringify(cachedResult));

      const result = await service.getTransactions(getTransactionsDto);

      expect(result).toEqual(cachedResult);
      expect(prismaService.wallet.findUnique).toHaveBeenCalledWith({
        where: { id: 'wallet-123' },
      });
      expect(prismaService.transaction.count).not.toHaveBeenCalled();
      expect(prismaService.transaction.findMany).not.toHaveBeenCalled();
    });

    it('should filter by transaction type', async () => {
      const dto = {
        ...getTransactionsDto,
        type: TransactionType.DEPOSIT,
      };

      prismaService.wallet.findUnique.mockResolvedValue(mockWallet);
      mockRedis.get.mockResolvedValue(null);
      prismaService.transaction.count.mockResolvedValue(0);
      prismaService.transaction.findMany.mockResolvedValue([]);

      await service.getTransactions(dto);

      expect(prismaService.transaction.findMany).toHaveBeenCalledWith({
        where: {
          walletId: 'wallet-123',
          type: TransactionType.DEPOSIT,
        },
        orderBy: { createdAt: 'desc' },
        skip: 0,
        take: 10,
        include: {
          wallet: { select: { userId: true } },
          destinationWallet: { select: { userId: true } },
        },
      });
    });

    it('should filter by transaction status', async () => {
      const dto = {
        ...getTransactionsDto,
        status: TransactionStatus.PENDING,
      };

      prismaService.wallet.findUnique.mockResolvedValue(mockWallet);
      mockRedis.get.mockResolvedValue(null);
      prismaService.transaction.count.mockResolvedValue(0);
      prismaService.transaction.findMany.mockResolvedValue([]);

      await service.getTransactions(dto);

      expect(prismaService.transaction.findMany).toHaveBeenCalledWith({
        where: {
          walletId: 'wallet-123',
          status: TransactionStatus.PENDING,
        },
        orderBy: { createdAt: 'desc' },
        skip: 0,
        take: 10,
        include: {
          wallet: { select: { userId: true } },
          destinationWallet: { select: { userId: true } },
        },
      });
    });

    it('should filter by date range', async () => {
      const dto = {
        ...getTransactionsDto,
        startDate: '2024-01-01',
        endDate: '2024-01-31',
      };

      prismaService.wallet.findUnique.mockResolvedValue(mockWallet);
      mockRedis.get.mockResolvedValue(null);
      prismaService.transaction.count.mockResolvedValue(0);
      prismaService.transaction.findMany.mockResolvedValue([]);

      await service.getTransactions(dto);

      expect(prismaService.transaction.findMany).toHaveBeenCalledWith({
        where: {
          walletId: 'wallet-123',
          createdAt: {
            gte: new Date('2024-01-01T00:00:00.000Z'),
            lte: new Date('2024-01-31T23:59:59.999Z'),
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: 0,
        take: 10,
        include: {
          wallet: { select: { userId: true } },
          destinationWallet: { select: { userId: true } },
        },
      });
    });

    it('should handle pagination correctly', async () => {
      const dto = {
        ...getTransactionsDto,
        page: 2,
        perPage: 5,
      };

      prismaService.wallet.findUnique.mockResolvedValue(mockWallet);
      mockRedis.get.mockResolvedValue(null);
      prismaService.transaction.count.mockResolvedValue(12);
      prismaService.transaction.findMany.mockResolvedValue([]);

      const result = await service.getTransactions(dto);

      expect(result.meta).toEqual({
        total: 12,
        page: 2,
        perPage: 5,
        totalPages: 3,
      });
      expect(prismaService.transaction.findMany).toHaveBeenCalledWith({
        where: { walletId: 'wallet-123' },
        orderBy: { createdAt: 'desc' },
        skip: 5,
        take: 5,
        include: {
          wallet: { select: { userId: true } },
          destinationWallet: { select: { userId: true } },
        },
      });
    });

    it('should cache the result', async () => {
      prismaService.wallet.findUnique.mockResolvedValue(mockWallet);
      mockRedis.get.mockResolvedValue(null);
      prismaService.transaction.count.mockResolvedValue(1);
      prismaService.transaction.findMany.mockResolvedValue([mockTransaction]);

      await service.getTransactions(getTransactionsDto);

      expect(mockRedis.set).toHaveBeenCalledWith(
        expect.stringContaining('transactions_wallet-123_'),
        expect.any(String),
        'EX',
        60,
      );
    });
  });

  describe('getTransactionById', () => {
    const transactionId = 'tx-id-123';

    it('should return transaction by ID', async () => {
      prismaService.transaction.findUnique.mockResolvedValue(mockTransaction);

      const result = await service.getTransactionById(transactionId);

      expect(result).toEqual(mockTransaction);
      expect(prismaService.transaction.findUnique).toHaveBeenCalledWith({
        where: { transactionId },
        include: {
          wallet: { select: { userId: true } },
          destinationWallet: { select: { userId: true } },
        },
      });
    });

    it('should throw NotFoundException when transaction does not exist', async () => {
      prismaService.transaction.findUnique.mockResolvedValue(null);

      await expect(service.getTransactionById(transactionId)).rejects.toThrow(
        new NotFoundException('Transaction not found'),
      );
    });
  });

  describe('getTransactionStats', () => {
    const walletId = 'wallet-123';

    it('should return transaction statistics', async () => {
      const mockStats = [
        {
          type: TransactionType.DEPOSIT,
          _sum: { amount: '500.00' },
          _count: { id: 3 },
        },
        {
          type: TransactionType.WITHDRAWAL,
          _sum: { amount: '200.00' },
          _count: { id: 2 },
        },
        {
          type: TransactionType.TRANSFER_IN,
          _sum: { amount: '150.00' },
          _count: { id: 1 },
        },
        {
          type: TransactionType.TRANSFER_OUT,
          _sum: { amount: '100.00' },
          _count: { id: 1 },
        },
      ];

      mockRedis.get.mockResolvedValue(null);
      prismaService.transaction.groupBy.mockResolvedValue(mockStats);

      const result = await service.getTransactionStats(walletId);

      expect(result).toEqual({
        totalDeposits: '500.00',
        totalWithdrawals: '200.00',
        totalTransfersIn: '150.00',
        totalTransfersOut: '100.00',
        transactionCount: 7,
      });
      expect(prismaService.transaction.groupBy).toHaveBeenCalledWith({
        by: ['type'],
        where: {
          walletId,
          status: TransactionStatus.COMPLETED,
        },
        _sum: { amount: true },
        _count: { id: true },
      });
    });

    it('should return cached stats when available', async () => {
      const cachedStats = {
        totalDeposits: '1000.00',
        totalWithdrawals: '500.00',
        totalTransfersIn: '200.00',
        totalTransfersOut: '100.00',
        transactionCount: 10,
      };
      mockRedis.get.mockResolvedValue(JSON.stringify(cachedStats));

      const result = await service.getTransactionStats(walletId);

      expect(result).toEqual(cachedStats);
      expect(prismaService.transaction.groupBy).not.toHaveBeenCalled();
    });

    it('should handle empty stats gracefully', async () => {
      mockRedis.get.mockResolvedValue(null);
      prismaService.transaction.groupBy.mockResolvedValue([]);

      const result = await service.getTransactionStats(walletId);

      expect(result).toEqual({
        totalDeposits: '0',
        totalWithdrawals: '0',
        totalTransfersIn: '0',
        totalTransfersOut: '0',
        transactionCount: 0,
      });
    });

    it('should handle null amounts in stats', async () => {
      const mockStats = [
        {
          type: TransactionType.DEPOSIT,
          _sum: { amount: null },
          _count: { id: 1 },
        },
      ];

      mockRedis.get.mockResolvedValue(null);
      prismaService.transaction.groupBy.mockResolvedValue(mockStats);

      const result = await service.getTransactionStats(walletId);

      expect(result).toEqual({
        totalDeposits: '0',
        totalWithdrawals: '0',
        totalTransfersIn: '0',
        totalTransfersOut: '0',
        transactionCount: 1,
      });
    });

    it('should cache the stats result', async () => {
      mockRedis.get.mockResolvedValue(null);
      prismaService.transaction.groupBy.mockResolvedValue([]);

      await service.getTransactionStats(walletId);

      expect(mockRedis.set).toHaveBeenCalledWith(
        `transaction_stats_${walletId}`,
        expect.any(String),
        'EX',
        300,
      );
    });

    it('should handle partial transaction types', async () => {
      const mockStats = [
        {
          type: TransactionType.DEPOSIT,
          _sum: { amount: '1000.00' },
          _count: { id: 5 },
        },
        {
          type: TransactionType.TRANSFER_OUT,
          _sum: { amount: '300.00' },
          _count: { id: 3 },
        },
      ];

      mockRedis.get.mockResolvedValue(null);
      prismaService.transaction.groupBy.mockResolvedValue(mockStats);

      const result = await service.getTransactionStats(walletId);

      expect(result).toEqual({
        totalDeposits: '1000.00',
        totalWithdrawals: '0',
        totalTransfersIn: '0',
        totalTransfersOut: '300.00',
        transactionCount: 8,
      });
    });
  });
});
