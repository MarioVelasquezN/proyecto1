import { PositiveInt } from '../../common/dto/numeric-field.decorators';

export class AddToCartDto {
  @PositiveInt('productId')
  productId: number;

  @PositiveInt('quantity')
  quantity: number;
}
