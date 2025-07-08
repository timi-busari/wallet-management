import { IsString, IsOptional, ValidateIf, registerDecorator, ValidationOptions, ValidationArguments } from 'class-validator';
import { Transform } from 'class-transformer';
import { Decimal } from 'decimal.js';
import { IsDecimalMin } from 'src/utils/validator.utils';



export class CreateWalletDto {
  @IsString()
  userId: string;

  @IsOptional()
  @IsDecimalMin(0)
  @Transform(({ value }) => {
    return new Decimal(value);
  })
  initialBalance?: Decimal;
}