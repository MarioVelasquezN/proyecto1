// InventoryModule replaced by StockModule (src/stock/stock.module.ts).
// This stub is kept so any stale import still compiles.
// AppModule now imports StockModule directly.
import { Module } from '@nestjs/common';
import { StockModule } from '../stock/stock.module';

@Module({ imports: [StockModule] })
export class InventoryModule {}
