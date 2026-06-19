import { IsInt, IsPositive } from 'class-validator';

export class DecreaseStockDto {
  @IsInt()
  @IsPositive()
  productId: number;

  @IsInt()
  @IsPositive()
  quantity: number;
}
