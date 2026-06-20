import { Type } from 'class-transformer';
import { IsDefined, IsInt, IsNumber, IsPositive, Min } from 'class-validator';

function compose(...decorators: PropertyDecorator[]): PropertyDecorator {
  return (target: object, key: string | symbol): void => {
    decorators.forEach((d) => d(target, key));
  };
}

/**
 * Required positive integer (IDs, quantities >= 1).
 * Coerces strings via @Type(() => Number).
 * Error messages: "${field} is required" | "${field} must be a positive integer"
 */
export const PositiveInt = (field: string): PropertyDecorator =>
  compose(
    IsDefined({ message: `${field} is required` }),
    Type(() => Number),
    IsInt({ message: `${field} must be a positive integer` }),
    IsPositive({ message: `${field} must be a positive integer` }),
  );

/**
 * Required non-negative integer (stock, counts that can be 0).
 * Coerces strings via @Type(() => Number).
 * Error messages: "${field} is required" | "${field} must be an integer >= 0"
 */
export const NonNegativeInt = (field: string): PropertyDecorator =>
  compose(
    IsDefined({ message: `${field} is required` }),
    Type(() => Number),
    IsInt({ message: `${field} must be an integer >= 0` }),
    Min(0, { message: `${field} must be an integer >= 0` }),
  );

/**
 * Required positive number (prices, floats > 0).
 * Coerces strings via @Type(() => Number).
 * Error messages: "${field} is required" | "${field} must be a positive number"
 */
export const PositiveNumber = (field: string): PropertyDecorator =>
  compose(
    IsDefined({ message: `${field} is required` }),
    Type(() => Number),
    IsNumber({}, { message: `${field} must be a positive number` }),
    IsPositive({ message: `${field} must be a positive number` }),
  );
