import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bull';
import { Queue } from 'bull';
import {
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { WalletService } from './wallet.service';
import { PrismaService } from '../../prisma/prisma.service';
import { Decimal } from 'decimal.js';
import {
  Wallet,
  Transaction,
  TransactionType,
  TransactionStatus,
} from '@prisma/client';
import Redis from 'ioredis';
import { getRedisToken, DEFAULT_REDIS_NAMESPACE } from '@songkeys/nestjs-redis';

// Mock Redis
const mockRedis = {
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
};

// Mock Queue
const mockQueue = {
  add: jest.fn(),
};

// Mock PrismaService
const mockPrismaService = {
  wallet: {
    create: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
  },
  transaction: {
    create: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    updateMany: jest.fn(),
  },
  $transaction: jest.fn(),
  executeTransaction: jest.fn(),
};

describe('WalletService', () => {
  let service: WalletService;
  let prisma: PrismaService;
  let redis: Redis;
  let queue: Queue;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WalletService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: getQueueToken('transaction'),
          useValue: mockQueue,
        },
        {
          provide: getRedisToken(DEFAULT_REDIS_NAMESPACE),
          useValue: mockRedis,
        },
      ],
    }).compile();

    service = module.get<WalletService>(WalletService);
    prisma = module.get<PrismaService>(PrismaService);
    redis = module.get<Redis>(getRedisToken(DEFAULT_REDIS_NAMESPACE));
    queue = module.get<Queue>(getQueueToken('transaction'));

    // clear all mocks before each test
    jest.clearAllMocks();
  });

  describe('createWallet', () => {
    it('should create a wallet successfully', async () => {
      const createWalletDto = {
        userId: 'user-123',
        initialBalance: new Decimal(100),
      };

      const mockWallet: Wallet = {
        id: 'wallet-123',
        userId: 'user-123',
        balance: new Decimal(100),
        isActive: true,
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrismaService.wallet.create.mockResolvedValue(mockWallet);
      mockRedis.set.mockResolvedValue('OK');

      const result = await service.createWallet(createWalletDto);

      expect(result).toEqual(mockWallet);
      expect(mockPrismaService.wallet.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-123',
          balance: new Decimal(100),
        },
      });
      expect(mockRedis.set).toHaveBeenCalledWith(
        'wallet_balance_wallet-123',
        JSON.stringify('100'),
        'EX',
        300,
      );
    });

    it('should create a wallet with default balance when not provided', async () => {
      const createWalletDto = {
        userId: 'user-123',
      };

      const mockWallet: Wallet = {
        id: 'wallet-123',
        userId: 'user-123',
        balance: new Decimal(0),
        isActive: true,
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrismaService.wallet.create.mockResolvedValue(mockWallet);
      mockRedis.set.mockResolvedValue('OK');

      const result = await service.createWallet(createWalletDto);

      expect(result).toEqual(mockWallet);
      expect(mockPrismaService.wallet.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-123',
          balance: new Decimal(0),
        },
      });
    });

    it('should throw ConflictException when user already has a wallet', async () => {
      const createWalletDto = {
        userId: 'user-123',
        initialBalance: new Decimal(100),
      };

      const prismaError = {
        code: 'P2002',
        meta: { target: ['userId'] },
      };

      mockPrismaService.wallet.create.mockRejectedValue(prismaError);

      await expect(service.createWallet(createWalletDto)).rejects.toThrow(
        ConflictException,
      );
    });

    it('should throw original error when it is not a unique constraint violation', async () => {
      const createWalletDto = {
        userId: 'user-123',
        initialBalance: new Decimal(100),
      };

      const genericError = new Error('Database error');
      mockPrismaService.wallet.create.mockRejectedValue(genericError);

      await expect(service.createWallet(createWalletDto)).rejects.toThrow(
        'Database error',
      );
    });
  });

  describe('getWallet', () => {
    it('should return a wallet when found', async () => {
      const mockWallet: Wallet = {
        id: 'wallet-123',
        userId: 'user-123',
        balance: new Decimal(100),
        isActive: true,
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrismaService.wallet.findFirst.mockResolvedValue(mockWallet);

      const result = await service.getWallet('wallet-123');

      expect(result).toEqual(mockWallet);
      expect(mockPrismaService.wallet.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'wallet-123',
          isActive: true,
        },
      });
    });

    it('should throw NotFoundException when wallet not found', async () => {
      mockPrismaService.wallet.findFirst.mockResolvedValue(null);

      await expect(service.getWallet('wallet-123')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getWalletBalance', () => {
    it('should return balance from cache when available', async () => {
      mockRedis.get.mockResolvedValue(JSON.stringify('150'));

      const result = await service.getWalletBalance('wallet-123');

      expect(result).toEqual(new Decimal(150));
      expect(mockRedis.get).toHaveBeenCalledWith('wallet_balance_wallet-123');
      expect(mockPrismaService.wallet.findFirst).not.toHaveBeenCalled();
    });

    it('should return balance from database when not cached', async () => {
      const mockWallet: Wallet = {
        id: 'wallet-123',
        userId: 'user-123',
        balance: new Decimal(100),
        isActive: true,
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockRedis.get.mockResolvedValue(null);
      mockPrismaService.wallet.findFirst.mockResolvedValue(mockWallet);
      mockRedis.set.mockResolvedValue('OK');

      const result = await service.getWalletBalance('wallet-123');

      expect(result).toEqual(new Decimal(100));
      expect(mockRedis.set).toHaveBeenCalledWith(
        'wallet_balance_wallet-123',
        JSON.stringify('100'),
        'EX',
        300,
      );
    });
  });

  describe('depositFunds', () => {
    it('should create a deposit transaction successfully', async () => {
      const depositDto = {
        walletId: 'wallet-123',
        amount: new Decimal(50),
        description: 'Test deposit',
        transactionId: 'tx-123',
      };

      const mockWallet: Wallet = {
        id: 'wallet-123',
        userId: 'user-123',
        balance: new Decimal(100),
        isActive: true,
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockTransaction: Transaction = {
        id: 'transaction-123',
        transactionId: 'tx-123',
        referenceId: null,
        walletId: 'wallet-123',
        destinationWalletId: null,
        amount: new Decimal(50),
        type: TransactionType.DEPOSIT,
        status: TransactionStatus.PENDING,
        description: 'Test deposit',
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrismaService.transaction.findUnique.mockResolvedValue(null);
      mockPrismaService.wallet.findFirst.mockResolvedValue(mockWallet);
      mockPrismaService.transaction.create.mockResolvedValue(mockTransaction);
      mockQueue.add.mockResolvedValue({});

      const result = await service.depositFunds(depositDto);

      expect(result).toEqual(mockTransaction);
      expect(mockQueue.add).toHaveBeenCalledWith('deposit', {
        walletId: 'wallet-123',
        amount: '50',
        description: 'Test deposit',
        transactionId: 'tx-123',
      });
    });

    it('should return existing transaction when duplicate transactionId', async () => {
      const depositDto = {
        walletId: 'wallet-123',
        amount: new Decimal(50),
        description: 'Test deposit',
        transactionId: 'tx-123',
      };

      const existingTransaction: Transaction = {
        id: 'transaction-123',
        transactionId: 'tx-123',
        referenceId: null,
        walletId: 'wallet-123',
        destinationWalletId: null,
        amount: new Decimal(50),
        type: TransactionType.DEPOSIT,
        status: TransactionStatus.COMPLETED,
        description: 'Test deposit',
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrismaService.transaction.findUnique.mockResolvedValue(
        existingTransaction,
      );

      const result = await service.depositFunds(depositDto);

      expect(result).toEqual(existingTransaction);
      expect(mockPrismaService.transaction.create).not.toHaveBeenCalled();
      expect(mockQueue.add).not.toHaveBeenCalled();
    });

    it('should generate UUID when transactionId not provided', async () => {
      const depositDto = {
        walletId: 'wallet-123',
        amount: new Decimal(50),
        description: 'Test deposit',
      };

      const mockWallet: Wallet = {
        id: 'wallet-123',
        userId: 'user-123',
        balance: new Decimal(100),
        isActive: true,
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrismaService.transaction.findUnique.mockResolvedValue(null);
      mockPrismaService.wallet.findFirst.mockResolvedValue(mockWallet);
      mockPrismaService.transaction.create.mockResolvedValue({} as Transaction);
      mockQueue.add.mockResolvedValue({});

      await service.depositFunds(depositDto);

      expect(mockPrismaService.transaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            transactionId: expect.any(String),
          }),
        }),
      );
    });
  });

  describe('withdrawFunds', () => {
    it('should create a withdrawal transaction successfully', async () => {
      const withdrawDto = {
        walletId: 'wallet-123',
        amount: new Decimal(50),
        description: 'Test withdrawal',
        transactionId: 'tx-123',
      };

      const mockWallet: Wallet = {
        id: 'wallet-123',
        userId: 'user-123',
        balance: new Decimal(100),
        isActive: true,
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockTransaction: Transaction = {
        id: 'transaction-123',
        transactionId: 'tx-123',
        referenceId: null,
        walletId: 'wallet-123',
        destinationWalletId: null,
        amount: new Decimal(50),
        type: TransactionType.WITHDRAWAL,
        status: TransactionStatus.PENDING,
        description: 'Test withdrawal',
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrismaService.transaction.findUnique.mockResolvedValue(null);
      mockRedis.get.mockResolvedValue(JSON.stringify('100'));
      mockPrismaService.wallet.findFirst.mockResolvedValue(mockWallet);
      mockPrismaService.transaction.create.mockResolvedValue(mockTransaction);
      mockQueue.add.mockResolvedValue({});

      const result = await service.withdrawFunds(withdrawDto);

      expect(result).toEqual(mockTransaction);
      expect(mockQueue.add).toHaveBeenCalledWith('withdrawal', {
        walletId: 'wallet-123',
        amount: '50',
        description: 'Test withdrawal',
        transactionId: 'tx-123',
      });
    });

    it('should throw BadRequestException when insufficient funds', async () => {
      const withdrawDto = {
        walletId: 'wallet-123',
        amount: new Decimal(150),
        description: 'Test withdrawal',
        transactionId: 'tx-123',
      };

      mockPrismaService.transaction.findUnique.mockResolvedValue(null);
      mockRedis.get.mockResolvedValue(JSON.stringify('100'));

      await expect(service.withdrawFunds(withdrawDto)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('transferFunds', () => {
    it('should create transfer transactions successfully', async () => {
      const transferDto = {
        sourceWalletId: 'wallet-123',
        destinationWalletId: 'wallet-456',
        amount: new Decimal(50),
        description: 'Test transfer',
        referenceId: 'ref-123',
      };

      const mockSourceWallet: Wallet = {
        id: 'wallet-123',
        userId: 'user-123',
        balance: new Decimal(100),
        isActive: true,
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockDestinationWallet: Wallet = {
        id: 'wallet-456',
        userId: 'user-456',
        balance: new Decimal(200),
        isActive: true,
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockTransactions: Transaction[] = [
        {
          id: 'transaction-123',
          transactionId: 'tx-123',
          referenceId: 'ref-123',
          walletId: 'wallet-123',
          destinationWalletId: 'wallet-456',
          amount: new Decimal(50),
          type: TransactionType.TRANSFER_OUT,
          status: TransactionStatus.PENDING,
          description: 'Test transfer',
          metadata: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'transaction-456',
          transactionId: 'tx-456',
          referenceId: 'ref-123',
          walletId: 'wallet-456',
          destinationWalletId: 'wallet-123',
          amount: new Decimal(50),
          type: TransactionType.TRANSFER_IN,
          status: TransactionStatus.PENDING,
          description: 'Test transfer',
          metadata: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      mockPrismaService.transaction.findMany.mockResolvedValue([]);
      mockPrismaService.wallet.findFirst
        .mockResolvedValueOnce(mockSourceWallet)
        .mockResolvedValueOnce(mockDestinationWallet);
      mockRedis.get.mockResolvedValue(JSON.stringify('100'));
      mockPrismaService.$transaction.mockResolvedValue(mockTransactions);
      mockQueue.add.mockResolvedValue({});

      const result = await service.transferFunds(transferDto);

      expect(result).toEqual(mockTransactions);
      expect(mockQueue.add).toHaveBeenCalledWith('transfer', {
        sourceWalletId: 'wallet-123',
        destinationWalletId: 'wallet-456',
        amount: '50',
        description: 'Test transfer',
        referenceId: 'ref-123',
      });
    });

    it('should return existing transactions when duplicate referenceId', async () => {
      const transferDto = {
        sourceWalletId: 'wallet-123',
        destinationWalletId: 'wallet-456',
        amount: new Decimal(50),
        description: 'Test transfer',
        referenceId: 'ref-123',
      };

      const existingTransactions: Transaction[] = [
        {
          id: 'transaction-123',
          transactionId: 'tx-123',
          referenceId: 'ref-123',
          walletId: 'wallet-123',
          destinationWalletId: 'wallet-456',
          amount: new Decimal(50),
          type: TransactionType.TRANSFER_OUT,
          status: TransactionStatus.COMPLETED,
          description: 'Test transfer',
          metadata: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      mockPrismaService.transaction.findMany.mockResolvedValue(
        existingTransactions,
      );

      const result = await service.transferFunds(transferDto);

      expect(result).toEqual(existingTransactions);
      expect(mockPrismaService.$transaction).not.toHaveBeenCalled();
      expect(mockQueue.add).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException when insufficient funds', async () => {
      const transferDto = {
        sourceWalletId: 'wallet-123',
        destinationWalletId: 'wallet-456',
        amount: new Decimal(150),
        description: 'Test transfer',
        referenceId: 'ref-123',
      };

      const mockSourceWallet: Wallet = {
        id: 'wallet-123',
        userId: 'user-123',
        balance: new Decimal(100),
        isActive: true,
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockDestinationWallet: Wallet = {
        id: 'wallet-456',
        userId: 'user-456',
        balance: new Decimal(200),
        isActive: true,
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrismaService.transaction.findMany.mockResolvedValue([]);
      mockPrismaService.wallet.findFirst
        .mockResolvedValueOnce(mockSourceWallet)
        .mockResolvedValueOnce(mockDestinationWallet);
      mockRedis.get.mockResolvedValue(JSON.stringify('100'));

      await expect(service.transferFunds(transferDto)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('processDeposit', () => {
    it('should process deposit successfully', async () => {
      const depositData = {
        walletId: 'wallet-123',
        amount: '50',
        transactionId: 'tx-123',
      };

      const mockWallet: Wallet = {
        id: 'wallet-123',
        userId: 'user-123',
        balance: new Decimal(100),
        isActive: true,
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const updatedWallet: Wallet = {
        ...mockWallet,
        balance: new Decimal(150),
        version: 2,
      };

      mockPrismaService.executeTransaction.mockImplementation(
        async (callback) => {
          const mockPrismaTransaction = {
            wallet: {
              findUnique: jest.fn().mockResolvedValue(mockWallet),
              update: jest.fn().mockResolvedValue(updatedWallet),
            },
            transaction: {
              updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            },
          };
          return callback(mockPrismaTransaction);
        },
      );

      mockRedis.set.mockResolvedValue('OK');

      await service.processDeposit(depositData);

      expect(mockPrismaService.executeTransaction).toHaveBeenCalled();
      expect(mockRedis.set).toHaveBeenCalledWith(
        'wallet_balance_wallet-123',
        JSON.stringify('150'),
        'EX',
        300,
      );
    });

    it('should handle deposit processing failure', async () => {
      const depositData = {
        walletId: 'wallet-123',
        amount: '50',
        transactionId: 'tx-123',
      };

      const error = new Error('Database error');
      mockPrismaService.executeTransaction.mockRejectedValue(error);
      mockPrismaService.transaction.updateMany.mockResolvedValue({ count: 1 });

      await expect(service.processDeposit(depositData)).rejects.toThrow(
        'Database error',
      );

      expect(mockPrismaService.transaction.updateMany).toHaveBeenCalledWith({
        where: { transactionId: 'tx-123' },
        data: { status: TransactionStatus.FAILED },
      });
    });
  });

  describe('processWithdrawal', () => {
    it('should process withdrawal successfully', async () => {
      const withdrawalData = {
        walletId: 'wallet-123',
        amount: '50',
        transactionId: 'tx-123',
      };

      const mockWallet: Wallet = {
        id: 'wallet-123',
        userId: 'user-123',
        balance: new Decimal(100),
        isActive: true,
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const updatedWallet: Wallet = {
        ...mockWallet,
        balance: new Decimal(50),
        version: 2,
      };

      mockPrismaService.executeTransaction.mockImplementation(
        async (callback) => {
          const mockPrismaTransaction = {
            wallet: {
              findUnique: jest.fn().mockResolvedValue(mockWallet),
              update: jest.fn().mockResolvedValue(updatedWallet),
            },
            transaction: {
              updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            },
          };
          return callback(mockPrismaTransaction);
        },
      );

      mockRedis.set.mockResolvedValue('OK');

      await service.processWithdrawal(withdrawalData);

      expect(mockPrismaService.executeTransaction).toHaveBeenCalled();
      expect(mockRedis.set).toHaveBeenCalledWith(
        'wallet_balance_wallet-123',
        JSON.stringify('50'),
        'EX',
        300,
      );
    });

    it('should handle insufficient funds during withdrawal processing', async () => {
      const withdrawalData = {
        walletId: 'wallet-123',
        amount: '150',
        transactionId: 'tx-123',
      };

      const mockWallet: Wallet = {
        id: 'wallet-123',
        userId: 'user-123',
        balance: new Decimal(100),
        isActive: true,
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrismaService.executeTransaction.mockImplementation(
        async (callback) => {
          const mockPrismaTransaction = {
            wallet: {
              findUnique: jest.fn().mockResolvedValue(mockWallet),
            },
          };
          return callback(mockPrismaTransaction);
        },
      );

      mockPrismaService.transaction.updateMany.mockResolvedValue({ count: 1 });

      await expect(service.processWithdrawal(withdrawalData)).rejects.toThrow(
        BadRequestException,
      );

      expect(mockPrismaService.transaction.updateMany).toHaveBeenCalledWith({
        where: { transactionId: 'tx-123' },
        data: { status: TransactionStatus.FAILED },
      });
    });
  });

  describe('processTransfer', () => {
    it('should process transfer successfully', async () => {
      const transferData = {
        sourceWalletId: 'wallet-123',
        destinationWalletId: 'wallet-456',
        amount: '50',
        referenceId: 'ref-123',
      };

      const mockSourceWallet: Wallet = {
        id: 'wallet-123',
        userId: 'user-123',
        balance: new Decimal(100),
        isActive: true,
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockDestinationWallet: Wallet = {
        id: 'wallet-456',
        userId: 'user-456',
        balance: new Decimal(200),
        isActive: true,
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const updatedSourceWallet: Wallet = {
        ...mockSourceWallet,
        balance: new Decimal(50),
        version: 2,
      };

      const updatedDestinationWallet: Wallet = {
        ...mockDestinationWallet,
        balance: new Decimal(250),
        version: 2,
      };

      mockPrismaService.executeTransaction.mockImplementation(
        async (callback) => {
          const mockPrismaTransaction = {
            wallet: {
              findMany: jest
                .fn()
                .mockResolvedValue([mockSourceWallet, mockDestinationWallet]),
              update: jest
                .fn()
                .mockResolvedValueOnce(updatedSourceWallet)
                .mockResolvedValueOnce(updatedDestinationWallet),
            },
            transaction: {
              updateMany: jest.fn().mockResolvedValue({ count: 2 }),
            },
          };
          return callback(mockPrismaTransaction);
        },
      );

      mockRedis.set.mockResolvedValue('OK');

      await service.processTransfer(transferData);

      expect(mockPrismaService.executeTransaction).toHaveBeenCalled();
      expect(mockRedis.set).toHaveBeenCalledWith(
        'wallet_balance_wallet-123',
        JSON.stringify('50'),
        'EX',
        300,
      );
      expect(mockRedis.set).toHaveBeenCalledWith(
        'wallet_balance_wallet-456',
        JSON.stringify('250'),
        'EX',
        300,
      );
    });

    it('should handle transfer processing failure', async () => {
      const transferData = {
        sourceWalletId: 'wallet-123',
        destinationWalletId: 'wallet-456',
        amount: '50',
        referenceId: 'ref-123',
      };

      const error = new Error('Database error');
      mockPrismaService.executeTransaction.mockRejectedValue(error);
      mockPrismaService.transaction.updateMany.mockResolvedValue({ count: 2 });

      await expect(service.processTransfer(transferData)).rejects.toThrow(
        'Database error',
      );

      expect(mockPrismaService.transaction.updateMany).toHaveBeenCalledWith({
        where: { referenceId: 'ref-123' },
        data: { status: TransactionStatus.FAILED },
      });
    });
  });

  describe('getWalletsByUserId', () => {
    it('should return user wallets', async () => {
      const mockWallets: Wallet[] = [
        {
          id: 'wallet-123',
          userId: 'user-123',
          balance: new Decimal(100),
          isActive: true,
          version: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'wallet-456',
          userId: 'user-123',
          balance: new Decimal(200),
          isActive: true,
          version: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      mockPrismaService.wallet.findMany.mockResolvedValue(mockWallets);

      const result = await service.getWalletsByUserId('user-123');

      expect(result).toEqual(mockWallets);
      expect(mockPrismaService.wallet.findMany).toHaveBeenCalledWith({
        where: {
          userId: 'user-123',
          isActive: true,
        },
        orderBy: {
          createdAt: 'desc',
        },
      });
    });
  });

  describe('deactivateWallet', () => {
    it('should deactivate wallet with zero balance', async () => {
      const mockWallet: Wallet = {
        id: 'wallet-123',
        userId: 'user-123',
        balance: new Decimal(0),
        isActive: true,
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const deactivatedWallet: Wallet = {
        ...mockWallet,
        isActive: false,
      };

      mockPrismaService.wallet.findFirst.mockResolvedValue(mockWallet);
      mockRedis.get.mockResolvedValue(JSON.stringify('0'));
      mockPrismaService.wallet.update.mockResolvedValue(deactivatedWallet);
      mockRedis.del.mockResolvedValue(1);

      const result = await service.deactivateWallet('wallet-123');

      expect(result).toEqual(deactivatedWallet);
      expect(mockPrismaService.wallet.update).toHaveBeenCalledWith({
        where: { id: 'wallet-123' },
        data: { isActive: false },
      });
      expect(mockRedis.del).toHaveBeenCalledWith('wallet_balance_wallet-123');
    });

    it('should throw BadRequestException when wallet has non-zero balance', async () => {
      const mockWallet: Wallet = {
        id: 'wallet-123',
        userId: 'user-123',
        balance: new Decimal(100),
        isActive: true,
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrismaService.wallet.findFirst.mockResolvedValue(mockWallet);
      mockRedis.get.mockResolvedValue(JSON.stringify('100'));

      await expect(service.deactivateWallet('wallet-123')).rejects.toThrow(
        BadRequestException,
      );
      expect(mockPrismaService.wallet.update).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when wallet not found', async () => {
      mockPrismaService.wallet.findFirst.mockResolvedValue(null);

      await expect(service.deactivateWallet('wallet-123')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle concurrent conflicts', async () => {
      const withdrawalData = {
        walletId: 'wallet-123',
        amount: '50',
        transactionId: 'tx-123',
      };

      const mockWallet: Wallet = {
        id: 'wallet-123',
        userId: 'user-123',
        balance: new Decimal(100),
        isActive: true,
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // simulate version conflict (optimistic locking failure)
      const versionConflictError = new Error('Version conflict');
      mockPrismaService.executeTransaction.mockImplementation(
        async (callback) => {
          const mockPrismaTransaction = {
            wallet: {
              findUnique: jest.fn().mockResolvedValue(mockWallet),
              update: jest.fn().mockRejectedValue(versionConflictError),
            },
          };
          return callback(mockPrismaTransaction);
        },
      );

      mockPrismaService.transaction.updateMany.mockResolvedValue({ count: 1 });

      await expect(service.processWithdrawal(withdrawalData)).rejects.toThrow(
        'Version conflict',
      );

      expect(mockPrismaService.transaction.updateMany).toHaveBeenCalledWith({
        where: { transactionId: 'tx-123' },
        data: { status: TransactionStatus.FAILED },
      });
    });

    it('should handle large decimal amounts correctly', async () => {
      const largeAmount = new Decimal('999999999999999999.99');
      const depositDto = {
        walletId: 'wallet-123',
        amount: largeAmount,
        description: 'Large deposit',
        transactionId: 'tx-123',
      };

      const mockWallet: Wallet = {
        id: 'wallet-123',
        userId: 'user-123',
        balance: new Decimal(0),
        isActive: true,
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrismaService.transaction.findUnique.mockResolvedValue(null);
      mockPrismaService.wallet.findFirst.mockResolvedValue(mockWallet);
      mockPrismaService.transaction.create.mockResolvedValue({
        amount: largeAmount,
      } as Transaction);
      mockQueue.add.mockResolvedValue({});

      await service.depositFunds(depositDto);

      expect(mockQueue.add).toHaveBeenCalledWith('deposit', {
        walletId: 'wallet-123',
        amount: largeAmount.toString(),
        description: 'Large deposit',
        transactionId: 'tx-123',
      });
    });

    it('should handle queue failures gracefully', async () => {
      const depositDto = {
        walletId: 'wallet-123',
        amount: new Decimal(50),
        description: 'Test deposit',
        transactionId: 'tx-123',
      };

      const mockWallet: Wallet = {
        id: 'wallet-123',
        userId: 'user-123',
        balance: new Decimal(100),
        isActive: true,
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrismaService.transaction.findUnique.mockResolvedValue(null);
      mockPrismaService.wallet.findFirst.mockResolvedValue(mockWallet);
      mockPrismaService.transaction.create.mockResolvedValue({} as Transaction);
      mockQueue.add.mockRejectedValue(new Error('Queue is down'));

      await expect(service.depositFunds(depositDto)).rejects.toThrow(
        'Queue is down',
      );
    });
  });

  describe('Cache Management', () => {
    it('should cache wallet balance with correct TTL', async () => {
      const balance = new Decimal(100);
      const walletId = 'wallet-123';

      // Access the private method through type assertion
      const cacheWalletBalance = (service as any).cacheWalletBalance;
      await cacheWalletBalance.call(service, walletId, balance);

      expect(mockRedis.set).toHaveBeenCalledWith(
        'wallet_balance_wallet-123',
        JSON.stringify('100'),
        'EX',
        300,
      );
    });

    it('should invalidate wallet cache', async () => {
      const walletId = 'wallet-123';

      // Access the private method through type assertion
      const invalidateWalletCache = (service as any).invalidateWalletCache;
      await invalidateWalletCache.call(service, walletId);

      expect(mockRedis.del).toHaveBeenCalledWith('wallet_balance_wallet-123');
    });
  });
});
