import { Injectable, NotFoundException, Logger, Inject } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { GetTransactionsDto } from './dto/get-transactions.dto';
import {
  Transaction,
  TransactionType,
  TransactionStatus,
  Prisma,
} from '@prisma/client';
import { DEFAULT_REDIS_NAMESPACE, InjectRedis } from '@songkeys/nestjs-redis';
import { Redis } from 'ioredis';

@Injectable()
export class TransactionService {
  private readonly logger = new Logger(TransactionService.name);

  constructor(
    private prisma: PrismaService,
    @InjectRedis(DEFAULT_REDIS_NAMESPACE) private readonly redis: Redis,
  ) {}

  async getTransactions(getTransactionsDto: GetTransactionsDto): Promise<{
    data: Transaction[];
    meta: {
      total: number;
      page: number;
      perPage: number;
      totalPages: number;
    };
  }> {
    const {
      walletId,
      page = 1,
      perPage = 10,
      type,
      status,
      startDate,
      endDate,
    } = getTransactionsDto;

    // check if wallet exists
    const wallet = await this.prisma.wallet.findUnique({
      where: { id: walletId },
    });

    if (!wallet) {
      throw new NotFoundException('Wallet not found');
    }

    // building where clause
    const where: Prisma.TransactionWhereInput = {
      walletId,
    };

    if (type) {
      where.type = type;
    }

    if (status) {
      where.status = status;
    }

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) {
        where.createdAt.gte = new Date(`${startDate}T00:00:00.000Z`);
      }
      if (endDate) {
        where.createdAt.lte = new Date(`${endDate}T23:59:59.999Z`);
      }
    }

    // set cache key
    const cacheKey = `transactions_${walletId}_${JSON.stringify(where)}_${page}_${perPage}`;

    // get from cache
    const cachedResult = await this.redis.get(cacheKey);

    if (cachedResult) {
      // parse stringified cacheResult
      return JSON.parse(cachedResult);
    }

    // get total count
    const total = await this.prisma.transaction.count({ where });

    // get transactions
    const transactions = await this.prisma.transaction.findMany({
      where,
      orderBy: {
        createdAt: 'desc',
      },
      skip: (page - 1) * perPage,
      take: perPage,
      include: {
        wallet: {
          select: {
            userId: true,
          },
        },
        destinationWallet: {
          select: {
            userId: true,
          },
        },
      },
    });

    const result = {
      data: transactions,
      meta: { total, page, perPage, totalPages: Math.ceil(total / perPage) },
    };

    await this.redis.set(cacheKey, JSON.stringify(result), 'EX', 60); // cache the result for 1 minute

    return result;
  }

  async getTransactionById(transactionId: string): Promise<Transaction> {
    const transaction = await this.prisma.transaction.findUnique({
      where: { transactionId },
      include: {
        wallet: {
          select: {
            userId: true,
          },
        },
        destinationWallet: {
          select: {
            userId: true,
          },
        },
      },
    });

    if (!transaction) {
      throw new NotFoundException('Transaction not found');
    }

    return transaction;
  }

  async getTransactionStats(walletId: string): Promise<{
    totalDeposits: string;
    totalWithdrawals: string;
    totalTransfersIn: string;
    totalTransfersOut: string;
    transactionCount: number;
  }> {
    const cacheKey = `transaction_stats_${walletId}`;

    // get stats from cache
    const cachedStats = await this.redis.get(cacheKey);
    if (cachedStats) {
      return JSON.parse(cachedStats);
    }

    const stats = await this.prisma.transaction.groupBy({
      by: ['type'],
      where: {
        walletId,
        status: TransactionStatus.COMPLETED,
      },
      _sum: {
        amount: true,
      },
      _count: {
        id: true,
      },
    });

    let totalDeposits = '0';
    let totalWithdrawals = '0';
    let totalTransfersIn = '0';
    let totalTransfersOut = '0';
    let transactionCount = 0;

    stats.forEach((stat) => {
      const amount = stat._sum.amount?.toString() || '0';
      const count = stat._count.id;

      switch (stat.type) {
        case TransactionType.DEPOSIT:
          totalDeposits = amount;
          break;
        case TransactionType.WITHDRAWAL:
          totalWithdrawals = amount;
          break;
        case TransactionType.TRANSFER_IN:
          totalTransfersIn = amount;
          break;
        case TransactionType.TRANSFER_OUT:
          totalTransfersOut = amount;
          break;
      }

      transactionCount += count;
    });

    const result = {
      totalDeposits,
      totalWithdrawals,
      totalTransfersIn,
      totalTransfersOut,
      transactionCount,
    };

    await this.redis.set(cacheKey, JSON.stringify(result), 'EX', 300); // cache for 5 minutes

    return result;
  }
}
