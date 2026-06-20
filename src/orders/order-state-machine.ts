import { UnprocessableEntityException } from '@nestjs/common';
import { OrderStatus } from './enums/order-status.enum';

const TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  [OrderStatus.Pending]:   [OrderStatus.Paid, OrderStatus.Cancelled],
  [OrderStatus.Paid]:      [OrderStatus.Delivered],
  [OrderStatus.Cancelled]: [],
  [OrderStatus.Delivered]: [],
};

export class OrderStateMachine {
  static transition(from: OrderStatus, to: OrderStatus): void {
    const allowed = TRANSITIONS[from] ?? [];

    if (!allowed.includes(to)) {
      const allowedDesc = allowed.length ? allowed.join(', ') : 'none (terminal state)';
      throw new UnprocessableEntityException(
        `Invalid transition: '${from}' → '${to}'. Allowed from '${from}': ${allowedDesc}`,
      );
    }
  }

  static allowedFrom(from: OrderStatus): readonly OrderStatus[] {
    return TRANSITIONS[from] ?? [];
  }
}
