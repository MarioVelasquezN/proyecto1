import {
  IsDefined,
  IsString,
  IsOptional,
  MinLength,
  MaxLength,
} from 'class-validator';
import {
  NonNegativeInt,
  PositiveInt,
  PositiveNumber,
} from '../../common/dto/numeric-field.decorators';

export class CreateProductDto {
  @IsDefined({ message: 'name is required' })
  @IsString({ message: 'name must be a string' })
  @MinLength(1, { message: 'name must not be empty' })
  @MaxLength(200, { message: 'name must not exceed 200 characters' })
  name: string;

  @IsString({ message: 'description must be a string' })
  @IsOptional()
  @MaxLength(1000, { message: 'description must not exceed 1000 characters' })
  description?: string;

  @PositiveNumber('price')
  price: number;

  @NonNegativeInt('stock')
  stock: number;

  @PositiveInt('categoryId')
  categoryId: number;
}
