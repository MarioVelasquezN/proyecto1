import { Type } from 'class-transformer';
import {
  IsString,
  IsInt,
  IsPositive,
  Min,
  Max,
  IsIn,
  IsOptional,
} from 'class-validator';

export class GetProductsDto {
  @IsString()
  @IsOptional()
  search?: string;

  @Type(() => Number)
  @IsInt()
  @IsPositive()
  @IsOptional()
  categoryId?: number;

  @IsIn(['name', 'price', 'stock', 'createdAt'])
  @IsOptional()
  sortBy?: 'name' | 'price' | 'stock' | 'createdAt';

  @IsIn(['asc', 'desc'])
  @IsOptional()
  sortOrder?: 'asc' | 'desc';

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  limit?: number;
}
