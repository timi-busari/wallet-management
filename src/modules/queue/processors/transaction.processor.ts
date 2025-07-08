import { Process, Processor, OnQueueActive, OnQueueCompleted, OnQueueFailed } from '@nestjs/bull';
import { Job } from 'bull';
import { Logger } from '@nestjs/common';
import { WalletService } from '../../wallet/wallet.service';

@Processor('transaction')
export class TransactionProcessor {
  private readonly logger = new Logger(TransactionProcessor.name);

  constructor(private walletService: WalletService) {}

  @OnQueueActive()
  onActive(job: Job) {
    this.logger.log(`:::::: Processing job ${job.id} of type ${job.name} :::::::`);
  }

  @OnQueueCompleted()
  onCompleted(job: Job) {
    this.logger.log(`::::::: Job ${job.id} completed successfully :::::::`);
  }

  @OnQueueFailed()
  onFailed(job: Job, err: Error) {
    this.logger.error(`::::::: Job ${job.id} failed with error: ${err.message} :::::::`);
  }

  @Process('deposit')
  async handleDeposit(job: Job) {
    const { walletId, amount, description, transactionId } = job.data;
    
    this.logger.log(`Processing deposit: ${amount} to wallet ${walletId}`);
    
    await this.walletService.processDeposit({
      walletId,
      amount,
      description,
      transactionId,
    });
  }

  @Process('withdrawal')
  async handleWithdrawal(job: Job) {
    const { walletId, amount, description, transactionId } = job.data;
    
    this.logger.log(`Processing withdrawal: ${amount} from wallet ${walletId}`);
    
    await this.walletService.processWithdrawal({
      walletId,
      amount,
      description,
      transactionId,
    });
  }

  @Process('transfer')
  async handleTransfer(job: Job) {
    const { sourceWalletId, destinationWalletId, amount, description, referenceId } = job.data;
    
    this.logger.log(`Processing transfer: ${amount} from ${sourceWalletId} to ${destinationWalletId}`);
    
    await this.walletService.processTransfer({
      sourceWalletId,
      destinationWalletId,
      amount,
      description,
      referenceId,
    });
  }
}