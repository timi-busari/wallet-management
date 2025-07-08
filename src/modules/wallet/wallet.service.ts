import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
  Inject,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateWalletDto } from './dto/create-wallet.dto';
import { DepositFundsDto } from './dto/deposit-funds.dto';
import { WithdrawFundsDto } from './dto/withdraw-funds.dto';
import { TransferFundsDto } from './dto/transfer-funds.dto';
import { Decimal } from 'decimal.js';
import { v4 as uuidv4 } from 'uuid';
import {
  Wallet,
  Transaction,
  TransactionType,
  TransactionStatus,
} from '@prisma/client';

import { InjectRedis, DEFAULT_REDIS_NAMESPACE } from '@songkeys/nestjs-redis';
import Redis from 'ioredis';

@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);

  constructor(
    private prisma: PrismaService,
    @InjectQueue('transaction') private transactionQueue: Queue,
    @InjectRedis(DEFAULT_REDIS_NAMESPACE) private readonly redis: Redis,
  ) {}

  async createWallet(createWalletDto: CreateWalletDto): Promise<Wallet> {
    const { userId, initialBalance = new Decimal(0) } = createWalletDto;

    try {
      const wallet = await this.prisma.wallet.create({
        data: {
          userId,
          balance: initialBalance,
        },
      });

      // cache the wallet balance
      await this.cacheWalletBalance(wallet.id, initialBalance);

      this.logger.log(`Created wallet ${wallet.id} for user ${userId}`);
      return wallet;
    } catch (error) {
      if (error.code === 'P2002' && error.meta?.target?.includes('userId')) {
        throw new ConflictException('User already has a wallet');
      }
      throw error;
    }
  }

  async getWallet(walletId: string): Promise<Wallet> {
    const wallet = await this.prisma.wallet.findFirst({
      where: {
        id: walletId,
        isActive: true,
      },
    });

    if (!wallet) {
      throw new NotFoundException('Wallet not found');
    }

    return wallet;
  }

  async getWalletBalance(walletId: string): Promise<Decimal> {
    // get balance from cache first
    const cachedBalance = await this.redis.get(`wallet_balance_${walletId}`);

    if (cachedBalance) {
      // parse stringified cacheResult
      const parsedBalance = JSON.parse(cachedBalance);
      return new Decimal(parsedBalance);
    }

    // get from database
    const wallet = await this.getWallet(walletId);

    // cache the balance
    await this.cacheWalletBalance(walletId, wallet.balance);

    return new Decimal(wallet.balance);
  }

  async depositFunds(depositFundsDto: DepositFundsDto): Promise<Transaction> {
    const {
      walletId,
      amount,
      description,
      transactionId = uuidv4(),
    } = depositFundsDto;

    // check for idempotency
    const existingTransaction = await this.prisma.transaction.findUnique({
      where: { transactionId },
    });

    if (existingTransaction) {
      return existingTransaction;
    }

    // validate wallet exists
    await this.getWallet(walletId);

    // create pending transaction
    const transaction = await this.prisma.transaction.create({
      data: {
        transactionId,
        walletId,
        amount,
        type: TransactionType.DEPOSIT,
        status: TransactionStatus.PENDING,
        description,
      },
    });

    // push to queue for processing
    await this.transactionQueue.add('deposit', {
      walletId,
      amount: amount.toString(),
      description,
      transactionId,
    });

    return transaction;
  }

  async withdrawFunds(
    withdrawFundsDto: WithdrawFundsDto,
  ): Promise<Transaction> {
    const {
      walletId,
      amount,
      description,
      transactionId = uuidv4(),
    } = withdrawFundsDto;

    // check for idempotency
    const existingTransaction = await this.prisma.transaction.findUnique({
      where: { transactionId },
    });

    if (existingTransaction) {
      return existingTransaction;
    }

    // check if wallet has sufficient funds
    const balance = await this.getWalletBalance(walletId);
    if (balance.lt(amount)) {
      throw new BadRequestException('Insufficient funds');
    }

    // create pending transaction
    const transaction = await this.prisma.transaction.create({
      data: {
        transactionId,
        walletId,
        amount,
        type: TransactionType.WITHDRAWAL,
        status: TransactionStatus.PENDING,
        description,
      },
    });

    // push to queue for processing
    await this.transactionQueue.add('withdrawal', {
      walletId,
      amount: amount.toString(),
      description,
      transactionId,
    });

    return transaction;
  }

  async transferFunds(
    transferFundsDto: TransferFundsDto,
  ): Promise<Transaction[]> {
    const {
      sourceWalletId,
      destinationWalletId,
      amount,
      description,
      referenceId,
    } = transferFundsDto;

    // checking for idempotency using the reference ID
    const existingTransactions = await this.prisma.transaction.findMany({
      where: { referenceId }, 
    });

    if (existingTransactions.length > 0) {
      return existingTransactions;
    }

    // validate wallets exist
    await this.getWallet(sourceWalletId);
    await this.getWallet(destinationWalletId);

    // checking if source wallet has sufficient funds
    const balance = await this.getWalletBalance(sourceWalletId);

    if (balance.lt(amount)) {
      throw new BadRequestException('Insufficient funds');
    }

    // create pending transactions with unique transaction IDs
    const transactions = await this.prisma.$transaction([
      this.prisma.transaction.create({
        data: {
          transactionId: uuidv4(), 
          referenceId, 
          walletId: sourceWalletId,
          destinationWalletId,
          amount,
          type: TransactionType.TRANSFER_OUT,
          status: TransactionStatus.PENDING,
          description,
        },
      }),
      this.prisma.transaction.create({
        data: {
          transactionId: uuidv4(), 
          referenceId, 
          walletId: destinationWalletId,
          destinationWalletId: sourceWalletId,
          amount,
          type: TransactionType.TRANSFER_IN,
          status: TransactionStatus.PENDING,
          description,
        },
      }),
    ]);

    // push to queue for processing
    await this.transactionQueue.add('transfer', {
      sourceWalletId,
      destinationWalletId,
      amount: amount.toString(),
      description,
      referenceId, 
    });

    return transactions;
  }
  async processDeposit(data: any): Promise<void> {
    const { walletId, amount, transactionId } = data;
    const amountDecimal = new Decimal(amount);

    try {
      await this.prisma.executeTransaction(async (prisma) => {
        // lock and get wallet
        const wallet = await prisma.wallet.findUnique({
          where: { id: walletId },
        });

        if (!wallet) {
          throw new NotFoundException('Wallet not found');
        }

        // update wallet balance using optimistic locking
        const updatedWallet = await prisma.wallet.update({
          where: {
            id: walletId,
            version: wallet.version,
          },
          data: {
            balance: {
              increment: amountDecimal,
            },
            version: {
              increment: 1,
            },
          },
        });

        // update transaction status
        await prisma.transaction.updateMany({
          where: { transactionId },
          data: { status: TransactionStatus.COMPLETED },
        });

        // update cache
        await this.cacheWalletBalance(walletId, updatedWallet.balance);
      });

      this.logger.log(`Processed deposit of ${amount} to wallet ${walletId}`);
    } catch (error) {
      // mark transaction as failed
      await this.prisma.transaction.updateMany({
        where: { transactionId },
        data: { status: TransactionStatus.FAILED },
      });

      this.logger.error(`Failed to process deposit: ${error.message}`);
      throw error;
    }
  }

  async processWithdrawal(data: any): Promise<void> {
    const { walletId, amount, transactionId } = data;
    const amountDecimal = new Decimal(amount);

    try {
      await this.prisma.executeTransaction(async (prisma) => {
        // lock and get wallet
        const wallet = await prisma.wallet.findUnique({
          where: { id: walletId },
        });

        if (!wallet) {
          throw new NotFoundException('Wallet not found');
        }

        // check for sufficient funds
        const currentBalance = new Decimal(wallet.balance);
        if (currentBalance.lt(amountDecimal)) {
          throw new BadRequestException('Insufficient funds');
        }

        // update wallet balance using optimistic locking
        const updatedWallet = await prisma.wallet.update({
          where: {
            id: walletId,
            version: wallet.version,
          },
          data: {
            balance: {
              decrement: amountDecimal,
            },
            version: {
              increment: 1,
            },
          },
        });

        // update transaction status
        await prisma.transaction.updateMany({
          where: { transactionId },
          data: { status: TransactionStatus.COMPLETED },
        });

        // update cache
        await this.cacheWalletBalance(walletId, updatedWallet.balance);
      });

      this.logger.log(
        `Processed withdrawal of ${amount} from wallet ${walletId}`,
      );
    } catch (error) {
      // mark transaction as failed
      await this.prisma.transaction.updateMany({
        where: { transactionId },
        data: { status: TransactionStatus.FAILED },
      });

      this.logger.error(`Failed to process withdrawal: ${error.message}`);
      throw error;
    }
  }

  async processTransfer(data: any): Promise<void> {
    const { sourceWalletId, destinationWalletId, amount, referenceId } = data;
    const amountDecimal = new Decimal(amount);

    try {
      await this.prisma.executeTransaction(async (prisma) => {
        // lock both wallets in consistent order to prevent deadlocks
        const walletIds = [sourceWalletId, destinationWalletId].sort();
        const wallets = await prisma.wallet.findMany({
          where: {
            id: { in: walletIds },
          },
        });

        const sourceWallet = wallets.find((w) => w.id === sourceWalletId);
        const destinationWallet = wallets.find(
          (w) => w.id === destinationWalletId,
        );

        if (!sourceWallet || !destinationWallet) {
          throw new NotFoundException('One or both wallets not found');
        }

        // check for sufficient funds
        const sourceBalance = new Decimal(sourceWallet.balance);
        if (sourceBalance.lt(amountDecimal)) {
          throw new BadRequestException('Insufficient funds');
        }

        // update source wallet
        const updatedSourceWallet = await prisma.wallet.update({
          where: {
            id: sourceWalletId,
            version: sourceWallet.version,
          },
          data: {
            balance: {
              decrement: amountDecimal,
            },
            version: {
              increment: 1,
            },
          },
        });

        // update destination wallet
        const updatedDestinationWallet = await prisma.wallet.update({
          where: {
            id: destinationWalletId,
            version: destinationWallet.version,
          },
          data: {
            balance: {
              increment: amountDecimal,
            },
            version: {
              increment: 1,
            },
          },
        });

        // update transaction status
        await prisma.transaction.updateMany({
          where: { referenceId },
          data: { status: TransactionStatus.COMPLETED },
        });

        // update cache for both wallets
        await Promise.all([
          this.cacheWalletBalance(sourceWalletId, updatedSourceWallet.balance),
          this.cacheWalletBalance(
            destinationWalletId,
            updatedDestinationWallet.balance,
          ),
        ]);
      });

      this.logger.log(
        `Processed transfer of ${amount} from wallet ${sourceWalletId} to ${destinationWalletId}`,
      );
    } catch (error) {
      // mark transactions as failed
      await this.prisma.transaction.updateMany({
        where: { referenceId },
        data: { status: TransactionStatus.FAILED },
      });

      this.logger.error(`Failed to process transfer: ${error.message}`);
      throw error;
    }
  }

  private async cacheWalletBalance(
    walletId: string,
    balance: Decimal,
  ): Promise<void> {
    await this.redis.set(
      `wallet_balance_${walletId}`,
      JSON.stringify(balance.toString()),
      'EX',
      300,
    ); // 5 minutes TTL
  }

  private async invalidateWalletCache(walletId: string): Promise<void> {
    await this.redis.del(`wallet_balance_${walletId}`);
  }

  async getWalletsByUserId(userId: string): Promise<Wallet[]> {
    return this.prisma.wallet.findMany({
      where: {
        userId,
        isActive: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async deactivateWallet(walletId: string): Promise<Wallet> {
    await this.getWallet(walletId);

    // check if wallet has zero balance
    const balance = await this.getWalletBalance(walletId);
    if (balance.gt(0)) {
      throw new BadRequestException(
        'Cannot deactivate wallet with non-zero balance',
      );
    }

    const updatedWallet = await this.prisma.wallet.update({
      where: { id: walletId },
      data: { isActive: false },
    });

    await this.invalidateWalletCache(walletId);
    return updatedWallet;
  }
}
