import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { GetProductsDto } from './dto/get-products.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Role } from '../auth/enums/role.enum';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';

const mockProductsService = {
  create: jest.fn(),
  findAll: jest.fn(),
};

const adminUser: JwtPayload = { sub: 1, email: 'admin@example.com', role: Role.Admin };
const normalUser: JwtPayload = { sub: 2, email: 'user@example.com', role: Role.User };

describe('ProductsController', () => {
  let controller: ProductsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProductsController],
      providers: [
        { provide: ProductsService, useValue: mockProductsService },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<ProductsController>(ProductsController);
    jest.clearAllMocks();
  });

  describe('GET /products', () => {
    it('delega al servicio con el DTO y retorna el resultado paginado', async () => {
      const paginatedResult = {
        data: [{ id: 1, name: 'Widget', price: 9.99 }],
        meta: { total: 1, page: 1, limit: 10, totalPages: 1 },
      };
      mockProductsService.findAll.mockResolvedValue(paginatedResult);

      const dto = {} as GetProductsDto;
      const result = await controller.findAll(dto);

      expect(result).toEqual(paginatedResult);
      expect(mockProductsService.findAll).toHaveBeenCalledWith(dto);
    });
  });

  describe('POST /products — lógica del controller', () => {
    it('admin crea producto con stock y categoryId y delega a ProductsService', async () => {
      const dto = { name: 'New Product', price: 19.99, stock: 10, categoryId: 1 };
      const created = {
        id: 1,
        name: dto.name,
        price: dto.price,
        stock: dto.stock,
        category: { id: 1, name: 'Electronics' },
        createdAt: new Date(),
      };
      mockProductsService.create.mockResolvedValue(created);

      const result = await controller.create(dto, adminUser);

      expect(mockProductsService.create).toHaveBeenCalledWith(dto, adminUser.sub);
      expect(result).toMatchObject({
        id: 1,
        name: 'New Product',
        stock: 10,
        category: { id: 1, name: 'Electronics' },
      });
    });
  });
});

// ─── Tests de autorización via RolesGuard directamente ───────────────────────

describe('ProductsController — autorización con RolesGuard real', () => {
  let controller: ProductsController;
  let rolesGuard: RolesGuard;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProductsController],
      providers: [
        { provide: ProductsService, useValue: mockProductsService },
        RolesGuard,
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<ProductsController>(ProductsController);
    rolesGuard = module.get<RolesGuard>(RolesGuard);
    jest.clearAllMocks();
  });

  it('usuario normal no puede crear productos — RolesGuard lanza 403', () => {
    const buildCtx = (role: Role) => ({
      getHandler: () => controller.create,
      getClass: () => ProductsController,
      switchToHttp: () => ({
        getRequest: () => ({ user: { sub: 99, email: 'u@e.com', role } }),
      }),
    });

    expect(() =>
      rolesGuard.canActivate(buildCtx(Role.User) as any),
    ).toThrow(ForbiddenException);
  });

  it('admin sí puede crear productos — RolesGuard retorna true', () => {
    const buildCtx = (role: Role) => ({
      getHandler: () => controller.create,
      getClass: () => ProductsController,
      switchToHttp: () => ({
        getRequest: () => ({ user: { sub: 1, email: 'a@e.com', role } }),
      }),
    });

    expect(rolesGuard.canActivate(buildCtx(Role.Admin) as any)).toBe(true);
  });
});
