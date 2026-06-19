import { IsInt, IsPositive } from 'class-validator';

export class RemoveFromCartDto {
  @IsInt()
  @IsPositive()
  productId: number;
}
