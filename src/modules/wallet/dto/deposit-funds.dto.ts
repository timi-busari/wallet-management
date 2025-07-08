import { IsString, IsNumber, IsOptional, Min } from 'class-validator';
import { Transform } from 'class-transformer';
import { Decimal } from 'decimal.js';
import { IsDecimalMin } from 'src/utils/validator.utils';

export class DepositFundsDto {
  @IsString()
  walletId: string;

  @IsDecimalMin(0.01)
  @Transform(({ value }) => new Decimal(value))
  amount: Decimal;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  transactionId?: string;
}
