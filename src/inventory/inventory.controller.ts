import {
  Controller,
  Post,
  Get,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { DecreaseStockDto } from './dto/decrease-stock.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('inventory')
@UseGuards(JwtAuthGuard)
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Post('decrease')
  @HttpCode(HttpStatus.OK)
  decrease(@Body() dto: DecreaseStockDto) {
    return this.inventoryService.decrease(dto);
  }

  @Get('status')
  getStatus() {
    return this.inventoryService.getStatus();
  }
}
