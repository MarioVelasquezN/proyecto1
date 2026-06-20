/// <reference types="jest" />
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateProductDto } from './create-product.dto';

// ── helpers ───────────────────────────────────────────────────────────────────

// Replicates the exact ValidationPipe options used in main.ts
const PIPE_OPTIONS = { whitelist: true, forbidNonWhitelisted: true };

function toDto(raw: Record<string, unknown>): CreateProductDto {
  return plainToInstance(CreateProductDto, raw);
}

async function errorsFor(raw: Record<string, unknown>): Promise<string[]> {
  const errors = await validate(toDto(raw), PIPE_OPTIONS);
  return errors.map((e) => e.property);
}

// Returns all constraint message strings across every failed field.
async function messagesFor(raw: Record<string, unknown>): Promise<string[]> {
  const errors = await validate(toDto(raw), PIPE_OPTIONS);
  return errors.flatMap((e) => Object.values(e.constraints ?? {}));
}

const VALID_RAW = {
  name: 'Laptop Pro',
  price: '999.99',
  stock: '10',
  categoryId: '1',
};

// ── @Type: conversión de strings a números ────────────────────────────────────

describe('CreateProductDto — @Type transformación', () => {
  it('convierte price string a number', () => {
    const dto = toDto({ ...VALID_RAW, price: '12.5' });
    expect(dto.price).toBe(12.5);
    expect(typeof dto.price).toBe('number');
  });

  it('convierte stock string a number', () => {
    const dto = toDto({ ...VALID_RAW, stock: '7' });
    expect(dto.stock).toBe(7);
    expect(typeof dto.stock).toBe('number');
  });

  it('convierte categoryId string a number', () => {
    const dto = toDto({ ...VALID_RAW, categoryId: '3' });
    expect(dto.categoryId).toBe(3);
    expect(typeof dto.categoryId).toBe('number');
  });

  it('acepta números nativos sin conversión extra', () => {
    const dto = toDto({ ...VALID_RAW, price: 99.9, stock: 5, categoryId: 2 });
    expect(dto.price).toBe(99.9);
    expect(dto.stock).toBe(5);
    expect(dto.categoryId).toBe(2);
  });
});

// ── validación pasa con payload correcto ──────────────────────────────────────

describe('CreateProductDto — validación pasa con payload correcto', () => {
  it('{ categoryId: "1", price: "12.5" } pasa validación', async () => {
    expect(await errorsFor(VALID_RAW)).toHaveLength(0);
  });

  it('pasa con price entero como string', async () => {
    expect(await errorsFor({ ...VALID_RAW, price: '100' })).toHaveLength(0);
  });

  it('pasa con description opcional presente', async () => {
    const errors = await errorsFor({ ...VALID_RAW, description: 'Descripción válida' });
    expect(errors).toHaveLength(0);
  });

  it('pasa sin description (campo opcional)', async () => {
    expect(await errorsFor(VALID_RAW)).toHaveLength(0);
  });

  it('pasa con stock = 0 (sin stock inicial)', async () => {
    expect(await errorsFor({ ...VALID_RAW, stock: '0' })).toHaveLength(0);
  });
});

// ── whitelist: campos extra se rechazan ───────────────────────────────────────

describe('CreateProductDto — forbidNonWhitelisted: campos extra rechazados', () => {
  it('rechaza un campo extra desconocido', async () => {
    const errors = await errorsFor({ ...VALID_RAW, campoExtra: 'valor' });
    expect(errors).toContain('campoExtra');
  });

  it('rechaza múltiples campos extra al mismo tiempo', async () => {
    const errors = await errorsFor({ ...VALID_RAW, hack: 'x', otro: 'y' });
    expect(errors).toContain('hack');
    expect(errors).toContain('otro');
  });

  it('rechaza inyección de campo de BD (ej: createdById)', async () => {
    const errors = await errorsFor({ ...VALID_RAW, createdById: '99' });
    expect(errors).toContain('createdById');
  });
});

// ── @IsDefined: campos obligatorios ausentes ──────────────────────────────────

describe('CreateProductDto — @IsDefined: campos obligatorios', () => {
  it('rechaza name ausente', async () => {
    const { name: _omit, ...rest } = VALID_RAW as Record<string, unknown>;
    expect(await errorsFor(rest)).toContain('name');
  });

  it('rechaza price ausente', async () => {
    const { price: _omit, ...rest } = VALID_RAW as Record<string, unknown>;
    expect(await errorsFor(rest)).toContain('price');
  });

  it('rechaza stock ausente', async () => {
    const { stock: _omit, ...rest } = VALID_RAW as Record<string, unknown>;
    expect(await errorsFor(rest)).toContain('stock');
  });

  it('rechaza categoryId ausente', async () => {
    const { categoryId: _omit, ...rest } = VALID_RAW as Record<string, unknown>;
    expect(await errorsFor(rest)).toContain('categoryId');
  });

  it('rechaza name null explícito', async () => {
    expect(await errorsFor({ ...VALID_RAW, name: null })).toContain('name');
  });
});

// ── price: debe ser número positivo ──────────────────────────────────────────

describe('CreateProductDto — price positivo', () => {
  it('rechaza price negativo', async () => {
    expect(await errorsFor({ ...VALID_RAW, price: '-5' })).toContain('price');
  });

  it('rechaza price = 0 (debe ser estrictamente positivo)', async () => {
    expect(await errorsFor({ ...VALID_RAW, price: '0' })).toContain('price');
  });

  it('rechaza price NaN (string no numérico)', async () => {
    expect(await errorsFor({ ...VALID_RAW, price: 'abc' })).toContain('price');
  });
});

// ── stock: debe ser entero >= 0 ───────────────────────────────────────────────

describe('CreateProductDto — stock entero >= 0', () => {
  it('rechaza stock negativo', async () => {
    expect(await errorsFor({ ...VALID_RAW, stock: '-1' })).toContain('stock');
  });

  it('rechaza stock decimal (no entero)', async () => {
    expect(await errorsFor({ ...VALID_RAW, stock: '1.5' })).toContain('stock');
  });
});

// ── categoryId: debe ser entero positivo ─────────────────────────────────────

describe('CreateProductDto — categoryId entero positivo', () => {
  it('rechaza categoryId = 0 (debe ser positivo)', async () => {
    expect(await errorsFor({ ...VALID_RAW, categoryId: '0' })).toContain('categoryId');
  });

  it('rechaza categoryId negativo', async () => {
    expect(await errorsFor({ ...VALID_RAW, categoryId: '-1' })).toContain('categoryId');
  });

  it('rechaza categoryId decimal', async () => {
    expect(await errorsFor({ ...VALID_RAW, categoryId: '1.5' })).toContain('categoryId');
  });
});

// ── name: longitud y tipo ─────────────────────────────────────────────────────

describe('CreateProductDto — name longitud y tipo', () => {
  it('rechaza name vacío', async () => {
    expect(await errorsFor({ ...VALID_RAW, name: '' })).toContain('name');
  });

  it('rechaza name con más de 200 caracteres', async () => {
    const errors = await errorsFor({ ...VALID_RAW, name: 'x'.repeat(201) });
    expect(errors).toContain('name');
  });

  it('acepta name con exactamente 200 caracteres', async () => {
    const errors = await errorsFor({ ...VALID_RAW, name: 'x'.repeat(200) });
    expect(errors).not.toContain('name');
  });
});

// ── mensajes personalizados ───────────────────────────────────────────────────

describe('CreateProductDto — mensajes de error personalizados', () => {
  // categoryId
  it('categoryId: -5 → "categoryId must be a positive integer"', async () => {
    const msgs = await messagesFor({ ...VALID_RAW, categoryId: '-5' });
    expect(msgs).toContain('categoryId must be a positive integer');
  });

  it('categoryId: 1.5 (decimal) → "categoryId must be a positive integer"', async () => {
    const msgs = await messagesFor({ ...VALID_RAW, categoryId: '1.5' });
    expect(msgs).toContain('categoryId must be a positive integer');
  });

  it('categoryId: 0 → "categoryId must be a positive integer"', async () => {
    const msgs = await messagesFor({ ...VALID_RAW, categoryId: '0' });
    expect(msgs).toContain('categoryId must be a positive integer');
  });

  it('categoryId ausente → "categoryId is required"', async () => {
    const { categoryId: _omit, ...rest } = VALID_RAW as Record<string, unknown>;
    const msgs = await messagesFor(rest);
    expect(msgs).toContain('categoryId is required');
  });

  // price
  it('price: "abc" → "price must be a positive number"', async () => {
    const msgs = await messagesFor({ ...VALID_RAW, price: 'abc' });
    expect(msgs).toContain('price must be a positive number');
  });

  it('price: -5 → "price must be a positive number"', async () => {
    const msgs = await messagesFor({ ...VALID_RAW, price: '-5' });
    expect(msgs).toContain('price must be a positive number');
  });

  it('price: 0 → "price must be a positive number"', async () => {
    const msgs = await messagesFor({ ...VALID_RAW, price: '0' });
    expect(msgs).toContain('price must be a positive number');
  });

  it('price ausente → "price is required"', async () => {
    const { price: _omit, ...rest } = VALID_RAW as Record<string, unknown>;
    const msgs = await messagesFor(rest);
    expect(msgs).toContain('price is required');
  });

  // stock
  it('stock: -1 → "stock must be an integer >= 0"', async () => {
    const msgs = await messagesFor({ ...VALID_RAW, stock: '-1' });
    expect(msgs).toContain('stock must be an integer >= 0');
  });

  it('stock: 1.5 (decimal) → "stock must be an integer >= 0"', async () => {
    const msgs = await messagesFor({ ...VALID_RAW, stock: '1.5' });
    expect(msgs).toContain('stock must be an integer >= 0');
  });

  it('stock ausente → "stock is required"', async () => {
    const { stock: _omit, ...rest } = VALID_RAW as Record<string, unknown>;
    const msgs = await messagesFor(rest);
    expect(msgs).toContain('stock is required');
  });

  // name
  it('name vacío → "name must not be empty"', async () => {
    const msgs = await messagesFor({ ...VALID_RAW, name: '' });
    expect(msgs).toContain('name must not be empty');
  });

  it('name ausente → "name is required"', async () => {
    const { name: _omit, ...rest } = VALID_RAW as Record<string, unknown>;
    const msgs = await messagesFor(rest);
    expect(msgs).toContain('name is required');
  });
});
