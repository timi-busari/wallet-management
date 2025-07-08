import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { TransactionService } from './transaction.service';
import { GetTransactionsDto } from './dto/get-transactions.dto';
import { ApiKeyGuard } from 'src/guards/api-key.guard';

@UseGuards(ApiKeyGuard)
@Controller('transactions')
export class TransactionController {
  constructor(private readonly transactionService: TransactionService) {}

  @Get('wallet/:walletId')
  async getTransactions(
    @Param('walletId') walletId: string,
    @Query() query: GetTransactionsDto,
  ) {
    const data = await this.transactionService.getTransactions({
      ...query,
      walletId,
    });
    return {
      success: true,
      ...data,
    };
  }

  @Get(':transactionId')
  async getTransactionById(@Param('transactionId') transactionId: string) {
    const transaction =
      await this.transactionService.getTransactionById(transactionId);
    return {
      success: true,
      data: transaction,
    };
  }

  @Get('wallet/:walletId/stats')
  async getTransactionStats(@Param('walletId') walletId: string) {
    const stats = await this.transactionService.getTransactionStats(walletId);
    return {
      success: true,
      data: stats,
    };
  }
}
