import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor(private configService: ConfigService) {
    super({
      datasources: {
        db: {
          url: configService.get('database.url'),
        },
      },
      log: [
        {
          emit: 'event',
          level: 'query',
        },
        {
          emit: 'event',
          level: 'error',
        },
        {
          emit: 'event',
          level: 'info',
        },
        {
          emit: 'event',
          level: 'warn',
        },
      ],
    });

    // set up event listeners
    this.setupEventListeners();
  }

  private setupEventListeners() {
    (this.$on as any)('query', (event: any) => {
      if (this.configService.get('nodeEnv') !== 'production') {
        this.logger.debug(`Query: ${event.query}`);
        this.logger.debug(`Params: ${event.params}`);
        this.logger.debug(`Duration: ${event.duration}ms`);
      }
    });

    (this.$on as any)('error', (event: any) => {
      this.logger.error(`Database error: ${event.message}`);
    });

    (this.$on as any)('info', (event: any) => {
      this.logger.log(`Database info: ${event.message}`);
    });

    (this.$on as any)('warn', (event: any) => {
      this.logger.warn(`Database warning: ${event.message}`);
    });
  }

  async onModuleInit() {
    try {
      await this.$connect();
      this.logger.log('Connected to database');
    } catch (error) {
      this.logger.error(`Failed to connect to database: ${error.message}`);
      throw error;
    }
  }

  async onModuleDestroy() {
    try {
      await this.$disconnect();
      this.logger.log('Disconnected from database');
    } catch (error) {
      this.logger.error(`Error disconnecting from database: ${error.message}`);
    }
  }

  // setup transaction method with retry logic
  async executeTransaction<T>(
    fn: (prisma: PrismaClient) => Promise<T>,
    maxRetries = 3,
  ): Promise<T> {
    let lastError: Error;

    for (let i = 0; i < maxRetries; i++) {
      try {
        return await this.$transaction(fn, {
          maxWait: 5000, // 5 seconds
          timeout: 10000, // 10 seconds
          isolationLevel: 'ReadCommitted',
        });
      } catch (error) {
        lastError = error;

        // check if it's a serialization failure or deadlock
        if (error.code === 'P2034' || error.code === 'P2028') {
          this.logger.warn(
            `Transaction retry ${i + 1}/${maxRetries}: ${error.message}`,
          );

          // exponential backoffl, retry delays:
          await new Promise(
            (resolve) => setTimeout(resolve, Math.pow(2, i) * 100), // Retry 1: 100ms   (2^0 * 100)
          );
          continue;
        }

        // if it's not a retryable error, throw immediately
        throw error;
      }
    }

    throw lastError;
  }

  // optimistic locking helper
  async updateWithOptimisticLock<T extends { version: number }>(
    model: any,
    where: any,
    data: any,
    currentVersion: number,
  ): Promise<T> {
    const result = await model.updateMany({
      where: {
        ...where,
        version: currentVersion,
      },
      data: {
        ...data,
        version: currentVersion + 1,
      },
    });

    if (result.count === 0) {
      throw new Error(
        'Optimistic lock failed - record was modified by another transaction',
      );
    }

    return model.findUnique({ where });
  }
}
