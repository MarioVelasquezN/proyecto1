import {
  IsString,
  IsNumber,
  Min,
  Max,
  IsDateString,
  IsBoolean,
  IsOptional,
} from 'class-validator';

export class CreateCouponDto {
  @IsString()
  code: string;

  @IsNumber()
  @Min(0)
  @Max(100)
  percentage: number;

  @IsDateString()
  expiresAt: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
