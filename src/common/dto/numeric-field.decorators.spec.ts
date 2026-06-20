import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AddToCartDto } from '../../cart/dto/add-to-cart.dto';
import { RemoveFromCartDto } from '../../cart/dto/remove-from-cart.dto';
import { DecreaseStockDto } from '../../stock/dto/decrease-stock.dto';
import { CreateOrderItemDto } from '../../orders/dto/create-order-item.dto';

// ── helpers ───────────────────────────────────────────────────────────────────

const PIPE_OPTIONS = { whitelist: true, forbidNonWhitelisted: true };

type AnyConstructor = new (...args: unknown[]) => object;

async function errorsFor(
  Cls: AnyConstructor,
  raw: Record<string, unknown>,
): Promise<string[]> {
  const errors = await validate(plainToInstance(Cls, raw), PIPE_OPTIONS);
  return errors.map((e) => e.property);
}

async function messagesFor(
  Cls: AnyConstructor,
  raw: Record<string, unknown>,
): Promise<string[]> {
  const errors = await validate(plainToInstance(Cls, raw), PIPE_OPTIONS);
  return errors.flatMap((e) => Object.values(e.constraints ?? {}));
}

// ── AddToCartDto ──────────────────────────────────────────────────────────────

describe('AddToCartDto', () => {
  const VALID = { productId: '5', quantity: '3' };

  describe('conversión de strings a números', () => {
    it('convierte productId string a number', () => {
      const dto = plainToInstance(AddToCartDto, VALID);
      expect(dto.productId).toBe(5);
      expect(typeof dto.productId).toBe('number');
    });

    it('convierte quantity string a number', () => {
      const dto = plainToInstance(AddToCartDto, VALID);
      expect(dto.quantity).toBe(3);
      expect(typeof dto.quantity).toBe('number');
    });

    it('acepta enteros nativos sin conversión extra', () => {
      const dto = plainToInstance(AddToCartDto, { productId: 7, quantity: 2 });
      expect(dto.productId).toBe(7);
      expect(dto.quantity).toBe(2);
    });
  });

  describe('validación pasa con payload correcto', () => {
    it('{ productId: "5", quantity: "3" } pasa validación', async () => {
      expect(await errorsFor(AddToCartDto, VALID)).toHaveLength(0);
    });

    it('pasa con productId y quantity como enteros', async () => {
      expect(await errorsFor(AddToCartDto, { productId: 1, quantity: 1 })).toHaveLength(0);
    });
  });

  describe('validación rechaza valores inválidos', () => {
    it('productId: -1 → error en productId', async () => {
      expect(await errorsFor(AddToCartDto, { ...VALID, productId: '-1' })).toContain('productId');
    });

    it('productId: 0 → error en productId', async () => {
      expect(await errorsFor(AddToCartDto, { ...VALID, productId: '0' })).toContain('productId');
    });

    it('productId: 1.5 (decimal) → error en productId', async () => {
      expect(await errorsFor(AddToCartDto, { ...VALID, productId: '1.5' })).toContain('productId');
    });

    it('quantity: 0 → error en quantity', async () => {
      expect(await errorsFor(AddToCartDto, { ...VALID, quantity: '0' })).toContain('quantity');
    });

    it('quantity: -2 → error en quantity', async () => {
      expect(await errorsFor(AddToCartDto, { ...VALID, quantity: '-2' })).toContain('quantity');
    });

    it('productId ausente → "productId is required"', async () => {
      const msgs = await messagesFor(AddToCartDto, { quantity: '1' });
      expect(msgs).toContain('productId is required');
    });

    it('quantity ausente → "quantity is required"', async () => {
      const msgs = await messagesFor(AddToCartDto, { productId: '1' });
      expect(msgs).toContain('quantity is required');
    });
  });

  describe('mensajes personalizados', () => {
    it('productId: -1 → "productId must be a positive integer"', async () => {
      const msgs = await messagesFor(AddToCartDto, { ...VALID, productId: '-1' });
      expect(msgs).toContain('productId must be a positive integer');
    });

    it('quantity: 0 → "quantity must be a positive integer"', async () => {
      const msgs = await messagesFor(AddToCartDto, { ...VALID, quantity: '0' });
      expect(msgs).toContain('quantity must be a positive integer');
    });
  });
});

// ── RemoveFromCartDto ─────────────────────────────────────────────────────────

describe('RemoveFromCartDto', () => {
  describe('conversión de strings a números', () => {
    it('convierte productId string a number', () => {
      const dto = plainToInstance(RemoveFromCartDto, { productId: '10' });
      expect(dto.productId).toBe(10);
      expect(typeof dto.productId).toBe('number');
    });
  });

  describe('validación', () => {
    it('{ productId: "10" } pasa validación', async () => {
      expect(await errorsFor(RemoveFromCartDto, { productId: '10' })).toHaveLength(0);
    });

    it('productId: 0 → error en productId', async () => {
      expect(await errorsFor(RemoveFromCartDto, { productId: '0' })).toContain('productId');
    });

    it('productId negativo → "productId must be a positive integer"', async () => {
      const msgs = await messagesFor(RemoveFromCartDto, { productId: '-3' });
      expect(msgs).toContain('productId must be a positive integer');
    });

    it('productId ausente → "productId is required"', async () => {
      const msgs = await messagesFor(RemoveFromCartDto, {});
      expect(msgs).toContain('productId is required');
    });
  });
});

// ── DecreaseStockDto ──────────────────────────────────────────────────────────

describe('DecreaseStockDto', () => {
  const VALID = { productId: '2', quantity: '5' };

  describe('conversión de strings a números', () => {
    it('convierte productId y quantity a number', () => {
      const dto = plainToInstance(DecreaseStockDto, VALID);
      expect(dto.productId).toBe(2);
      expect(dto.quantity).toBe(5);
    });
  });

  describe('validación', () => {
    it('{ productId: "2", quantity: "5" } pasa validación', async () => {
      expect(await errorsFor(DecreaseStockDto, VALID)).toHaveLength(0);
    });

    it('productId: 0 → error en productId', async () => {
      expect(await errorsFor(DecreaseStockDto, { ...VALID, productId: '0' })).toContain('productId');
    });

    it('quantity: -1 → error en quantity', async () => {
      expect(await errorsFor(DecreaseStockDto, { ...VALID, quantity: '-1' })).toContain('quantity');
    });

    it('quantity: 1.5 → "quantity must be a positive integer"', async () => {
      const msgs = await messagesFor(DecreaseStockDto, { ...VALID, quantity: '1.5' });
      expect(msgs).toContain('quantity must be a positive integer');
    });

    it('productId ausente → "productId is required"', async () => {
      const msgs = await messagesFor(DecreaseStockDto, { quantity: '1' });
      expect(msgs).toContain('productId is required');
    });
  });
});

// ── CreateOrderItemDto ────────────────────────────────────────────────────────

describe('CreateOrderItemDto', () => {
  const VALID = { productId: '3', quantity: '2' };

  describe('conversión de strings a números (bug fix — faltaba @Type)', () => {
    it('convierte productId string a number', () => {
      const dto = plainToInstance(CreateOrderItemDto, VALID);
      expect(dto.productId).toBe(3);
      expect(typeof dto.productId).toBe('number');
    });

    it('convierte quantity string a number', () => {
      const dto = plainToInstance(CreateOrderItemDto, VALID);
      expect(dto.quantity).toBe(2);
      expect(typeof dto.quantity).toBe('number');
    });
  });

  describe('validación pasa con payload correcto', () => {
    it('{ productId: "3", quantity: "2" } pasa validación', async () => {
      expect(await errorsFor(CreateOrderItemDto, VALID)).toHaveLength(0);
    });

    it('pasa con enteros nativos', async () => {
      expect(await errorsFor(CreateOrderItemDto, { productId: 1, quantity: 10 })).toHaveLength(0);
    });
  });

  describe('validación rechaza valores inválidos', () => {
    it('productId: 0 → error en productId', async () => {
      expect(await errorsFor(CreateOrderItemDto, { ...VALID, productId: '0' })).toContain('productId');
    });

    it('productId: -1 → error en productId', async () => {
      expect(await errorsFor(CreateOrderItemDto, { ...VALID, productId: '-1' })).toContain('productId');
    });

    it('quantity: 0 → error en quantity', async () => {
      expect(await errorsFor(CreateOrderItemDto, { ...VALID, quantity: '0' })).toContain('quantity');
    });

    it('quantity: 1.5 → "quantity must be a positive integer"', async () => {
      const msgs = await messagesFor(CreateOrderItemDto, { ...VALID, quantity: '1.5' });
      expect(msgs).toContain('quantity must be a positive integer');
    });

    it('productId ausente → "productId is required"', async () => {
      const msgs = await messagesFor(CreateOrderItemDto, { quantity: '2' });
      expect(msgs).toContain('productId is required');
    });

    it('quantity ausente → "quantity is required"', async () => {
      const msgs = await messagesFor(CreateOrderItemDto, { productId: '3' });
      expect(msgs).toContain('quantity is required');
    });
  });
});
