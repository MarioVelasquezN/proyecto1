import { Module } from '@nestjs/common';
import { CheckoutService } from './checkout.service';
import { CheckoutController } from './checkout.controller';
import { AuthModule } from '../auth/auth.module';
import { CartModule } from '../cart/cart.module';
import { StockModule } from '../stock/stock.module';
import { OrdersModule } from '../orders/orders.module';

@Module({
  imports: [AuthModule, CartModule, StockModule, OrdersModule],
  controllers: [CheckoutController],
  providers: [CheckoutService],
})
export class CheckoutModule {}
