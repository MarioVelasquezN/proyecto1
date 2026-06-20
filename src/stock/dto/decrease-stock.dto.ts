import { PositiveInt } from '../../common/dto/numeric-field.decorators';

export class DecreaseStockDto {
  @PositiveInt('productId')
  productId: number;

  @PositiveInt('quantity')
  quantity: number;
}
