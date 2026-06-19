import { IsIn } from 'class-validator';
import { OrderStatus } from '../enums/order-status.enum';

// @IsIn instead of @IsEnum so only the DB-compatible lowercase values are accepted,
// not the TypeScript enum keys ('Pending', 'Paid', …).
export class UpdateOrderStatusDto {
  @IsIn(Object.values(OrderStatus), {
    message: `status must be one of: ${Object.values(OrderStatus).join(', ')}`,
  })
  status: OrderStatus;
}
