import { Controller, Get, Post, Delete, Body, UseGuards } from '@nestjs/common';
import { CartService } from './cart.service';
import { AddToCartDto } from './dto/add-to-cart.dto';
import { RemoveFromCartDto } from './dto/remove-from-cart.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';

@Controller('cart')
@UseGuards(JwtAuthGuard)
export class CartController {
  constructor(private readonly cartService: CartService) {}

  @Post('add')
  add(@Body() dto: AddToCartDto, @CurrentUser() user: JwtPayload) {
    return this.cartService.add(dto, user.sub);
  }

  @Get()
  get(@CurrentUser() user: JwtPayload) {
    return this.cartService.get(user.sub);
  }

  @Delete('remove')
  remove(@Body() dto: RemoveFromCartDto, @CurrentUser() user: JwtPayload) {
    return this.cartService.remove(dto, user.sub);
  }
}
