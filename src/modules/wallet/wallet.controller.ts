import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  UseGuards,
  HttpStatus,
  HttpCode,
  Query,
} from '@nestjs/common';
import { WalletService } from './wallet.service';
import { CreateWalletDto } from './dto/create-wallet.dto';
import { DepositFundsDto } from './dto/deposit-funds.dto';
import { WithdrawFundsDto } from './dto/withdraw-funds.dto';
import { TransferFundsDto } from './dto/transfer-funds.dto';
import { ApiKeyGuard } from 'src/guards/api-key.guard';

@UseGuards(ApiKeyGuard)
@Controller('wallets')
export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createWallet(@Body() createWalletDto: CreateWalletDto) {
    const wallet = await this.walletService.createWallet(createWalletDto);
    return {
      success: true,
      data: wallet,
      message: 'Wallet created successfully',
    };
  }

  @Get(':walletId')
  async getWallet(@Param('walletId') walletId: string) {
    const wallet = await this.walletService.getWallet(walletId);
    return {
      success: true,
      data: wallet,
    };
  }

  @Get(':walletId/balance')
  async getWalletBalance(@Param('walletId') walletId: string) {
    const balance = await this.walletService.getWalletBalance(walletId);
    return {
      success: true,
      data: {
        walletId,
        balance: balance.toString(),
      },
    };
  }

  @Get('user/:userId')
  async getWalletsByUserId(@Param('userId') userId: string) {
    const wallets = await this.walletService.getWalletsByUserId(userId);
    return {
      success: true,
      data: wallets,
    };
  }

  @Post('deposit')
  @HttpCode(HttpStatus.CREATED)
  async depositFunds(@Body() depositFundsDto: DepositFundsDto) {
    const transaction = await this.walletService.depositFunds(depositFundsDto);
    return {
      success: true,
      data: transaction,
      message: 'Deposit initiated successfully',
    };
  }

  @Post('withdraw')
  @HttpCode(HttpStatus.CREATED)
  async withdrawFunds(@Body() withdrawFundsDto: WithdrawFundsDto) {
    const transaction =
      await this.walletService.withdrawFunds(withdrawFundsDto);
    return {
      success: true,
      data: transaction,
      message: 'Withdrawal initiated successfully',
    };
  }

  @Post('transfer')
  @HttpCode(HttpStatus.CREATED)
  async transferFunds(@Body() transferFundsDto: TransferFundsDto) {
    const transactions =
      await this.walletService.transferFunds(transferFundsDto);
    return {
      success: true,
      data: transactions,
      message: 'Transfer initiated successfully',
    };
  }

  @Delete(':walletId')
  async deactivateWallet(@Param('walletId') walletId: string) {
    const wallet = await this.walletService.deactivateWallet(walletId);
    return {
      success: true,
      data: wallet,
      message: 'Wallet deactivated successfully',
    };
  }
}
