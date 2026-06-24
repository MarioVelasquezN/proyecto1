import { Type } from 'class-transformer';
import {
  IsString,
  IsOptional,
  MinLength,
  MaxLength,
  IsNumber,
  IsPositive,
  IsInt,
  Min,
} from 'class-validator';

export class UpdateProductDto {
  @IsString()
  @IsOptional()
  @MinLength(1, { message: 'name must not be empty' })
  @MaxLength(200, { message: 'name must not exceed 200 characters' })
  name?: string;

  @IsString()
  @IsOptional()
  @MaxLength(1000, { message: 'description must not exceed 1000 characters' })
  description?: string;

  @Type(() => Number)
  @IsNumber({}, { message: 'price must be a positive number' })
  @IsPositive({ message: 'price must be a positive number' })
  @IsOptional()
  price?: number;

  @Type(() => Number)
  @IsInt({ message: 'stock must be an integer >= 0' })
  @Min(0, { message: 'stock must be an integer >= 0' })
  @IsOptional()
  stock?: number;

  @Type(() => Number)
  @IsInt({ message: 'categoryId must be a positive integer' })
  @IsPositive({ message: 'categoryId must be a positive integer' })
  @IsOptional()
  categoryId?: number;
}
