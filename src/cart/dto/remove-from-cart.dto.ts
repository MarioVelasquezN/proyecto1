import { PositiveInt } from '../../common/dto/numeric-field.decorators';

export class RemoveFromCartDto {
  @PositiveInt('productId')
  productId: number;
}
