// Tests moved to src/stock/stock.service.spec.ts.
// InventoryService is now an alias for StockService.
// This file is kept as a pass-through so the test runner doesn't error.
import { StockService } from '../stock/stock.service';

describe('InventoryService (alias → StockService)', () => {
  it('InventoryService re-exports StockService', () => {
    // Ensure the re-export resolves to the same class
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { InventoryService } = require('./inventory.service');
    expect(InventoryService).toBe(StockService);
  });
});
