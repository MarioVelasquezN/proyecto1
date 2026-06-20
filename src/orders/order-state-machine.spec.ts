import { UnprocessableEntityException } from '@nestjs/common';
import { OrderStateMachine } from './order-state-machine';
import { OrderStatus } from './enums/order-status.enum';

describe('OrderStateMachine', () => {
  // ── transición válida funciona correctamente ────────────────────────────────

  describe('transiciones válidas', () => {
    it.each([
      [OrderStatus.Pending,   OrderStatus.Paid,       'pending → paid'],
      [OrderStatus.Pending,   OrderStatus.Cancelled,  'pending → cancelled'],
      [OrderStatus.Paid,      OrderStatus.Delivered,  'paid → delivered'],
    ] as const)(
      'transición válida: %s',
      (from, to, _label) => {
        expect(() => OrderStateMachine.transition(from, to)).not.toThrow();
      },
    );
  });

  // ── transición inválida lanza error ────────────────────────────────────────

  describe('transiciones inválidas', () => {
    it.each([
      [OrderStatus.Paid,      OrderStatus.Pending,    'retroceso no permitido'],
      [OrderStatus.Paid,      OrderStatus.Cancelled,  'paid no puede cancelarse'],
      [OrderStatus.Delivered, OrderStatus.Paid,       'estado terminal'],
      [OrderStatus.Delivered, OrderStatus.Pending,    'estado terminal'],
      [OrderStatus.Delivered, OrderStatus.Cancelled,  'estado terminal'],
      [OrderStatus.Cancelled, OrderStatus.Paid,       'estado terminal'],
      [OrderStatus.Cancelled, OrderStatus.Pending,    'estado terminal'],
      [OrderStatus.Cancelled, OrderStatus.Delivered,  'estado terminal'],
    ] as const)(
      "transición inválida '%s' → '%s' lanza UnprocessableEntityException (%s)",
      (from, to, _label) => {
        expect(() => OrderStateMachine.transition(from, to)).toThrow(
          UnprocessableEntityException,
        );
      },
    );

    it('mismo estado como destino también es inválido (paid → paid)', () => {
      expect(() =>
        OrderStateMachine.transition(OrderStatus.Paid, OrderStatus.Paid),
      ).toThrow(UnprocessableEntityException);
    });
  });

  // ── mensaje de error ───────────────────────────────────────────────────────

  describe('mensaje de error', () => {
    it('incluye el estado origen en el mensaje', () => {
      const err = getError(() =>
        OrderStateMachine.transition(OrderStatus.Paid, OrderStatus.Pending),
      );
      expect(err.message).toMatch(/paid/);
    });

    it('incluye el estado destino en el mensaje', () => {
      const err = getError(() =>
        OrderStateMachine.transition(OrderStatus.Paid, OrderStatus.Pending),
      );
      expect(err.message).toMatch(/pending/);
    });

    it('menciona "terminal state" para estados delivered y cancelled', () => {
      const errDelivered = getError(() =>
        OrderStateMachine.transition(OrderStatus.Delivered, OrderStatus.Paid),
      );
      expect(errDelivered.message).toMatch(/terminal/i);

      const errCancelled = getError(() =>
        OrderStateMachine.transition(OrderStatus.Cancelled, OrderStatus.Paid),
      );
      expect(errCancelled.message).toMatch(/terminal/i);
    });

    it('lista las transiciones permitidas cuando las hay (no terminal)', () => {
      const err = getError(() =>
        OrderStateMachine.transition(OrderStatus.Paid, OrderStatus.Pending),
      );
      // paid allows only delivered, so message should mention it
      expect(err.message).toMatch(/delivered/);
    });
  });

  // ── allowedFrom ────────────────────────────────────────────────────────────

  describe('allowedFrom', () => {
    it('pending permite paid y cancelled', () => {
      const allowed = OrderStateMachine.allowedFrom(OrderStatus.Pending);
      expect(allowed).toContain(OrderStatus.Paid);
      expect(allowed).toContain(OrderStatus.Cancelled);
    });

    it('paid permite solo delivered', () => {
      const allowed = OrderStateMachine.allowedFrom(OrderStatus.Paid);
      expect(allowed).toEqual([OrderStatus.Delivered]);
    });

    it('delivered es terminal: no permite ninguna transición', () => {
      expect(OrderStateMachine.allowedFrom(OrderStatus.Delivered)).toHaveLength(0);
    });

    it('cancelled es terminal: no permite ninguna transición', () => {
      expect(OrderStateMachine.allowedFrom(OrderStatus.Cancelled)).toHaveLength(0);
    });
  });

  // ── no hay lógica de estado fuera de la state machine ─────────────────────

  describe('centralización de lógica', () => {
    it('TRANSITIONS solo está definido dentro de OrderStateMachine (no exportado)', () => {
      // El módulo no exporta ninguna constante de transiciones — la lógica
      // está encapsulada. Cualquier consumidor debe pasar por transition().
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require('./order-state-machine') as Record<string, unknown>;
      const exportedKeys = Object.keys(mod);
      expect(exportedKeys).toEqual(['OrderStateMachine']);
    });

    it('todos los OrderStatus están cubiertos por allowedFrom (no hay estado sin regla)', () => {
      for (const status of Object.values(OrderStatus)) {
        expect(() => OrderStateMachine.allowedFrom(status)).not.toThrow();
      }
    });
  });
});

// ── helper ────────────────────────────────────────────────────────────────────

function getError(fn: () => void): UnprocessableEntityException {
  try {
    fn();
    throw new Error('Expected function to throw, but it did not');
  } catch (err) {
    if (err instanceof UnprocessableEntityException) return err;
    throw err;
  }
}
