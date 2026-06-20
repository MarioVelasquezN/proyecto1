import {
  Controller,
  Post,
  Get,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { StockService } from './stock.service';
import { DecreaseStockDto } from './dto/decrease-stock.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

// Keeps /inventory prefix so existing clients don't break.
@Controller('inventory')
@UseGuards(JwtAuthGuard)
export class StockController {
  constructor(private readonly stockService: StockService) {}

  @Post('decrease')
  @HttpCode(HttpStatus.OK)
  decrease(@Body() dto: DecreaseStockDto) {
    return this.stockService.decrease(dto);
  }

  @Get('status')
  getStatus() {
    return this.stockService.getStatus();
  }
}
