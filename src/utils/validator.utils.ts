import { ValidationArguments, ValidationOptions, registerDecorator } from "class-validator";
import Decimal from "decimal.js";

// custom validator for Decimal
export function IsDecimalMin(min: number, validationOptions?: ValidationOptions) {
    return function (object: Object, propertyName: string) {
      registerDecorator({
        name: 'isDecimalMin',
        target: object.constructor,
        propertyName: propertyName,
        constraints: [min],
        options: validationOptions,
        validator: {
          validate(value: any, args: ValidationArguments) {
            if (value === undefined || value === null) return true; // letting @IsOptional handle this
            
            try {
              const decimal = new Decimal(value);
              return decimal.greaterThanOrEqualTo(args.constraints[0]);
            } catch {
              return false;
            }
          },
          defaultMessage(args: ValidationArguments) {
            return `${args.property} must not be less than ${args.constraints[0]}`;
          }
        }
      });
    };
  }