import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { UsersService } from './users.service';
import { PrismaService } from '../prisma/prisma.service';

const prismaMock = {
  user: {
    create: jest.fn(),
    findUnique: jest.fn(),
  },
};

const dto = {
  email: 'john@example.com',
  password: 'plaintext123',
  name: 'John Doe',
};

describe('UsersService', () => {
  let service: UsersService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('creates user and returns it without password field', async () => {
      prismaMock.user.create.mockResolvedValue({
        id: 1,
        email: dto.email,
        name: dto.name,
        password: '$2b$10$hashedvalue',
        createdAt: new Date(),
      });

      const result = await service.create(dto);

      expect(result).toMatchObject({ id: 1, email: dto.email, name: dto.name });
      expect(result).not.toHaveProperty('password');
    });

    it('stores a valid bcrypt hash — never the plain-text password', async () => {
      let capturedPassword = '';

      prismaMock.user.create.mockImplementation(({ data }: { data: any }) => {
        capturedPassword = data.password;
        return Promise.resolve({
          id: 1,
          email: data.email,
          name: data.name,
          password: data.password,
          createdAt: new Date(),
        });
      });

      await service.create(dto);

      expect(capturedPassword).not.toBe(dto.password);
      const hashIsValid = await bcrypt.compare(dto.password, capturedPassword);
      expect(hashIsValid).toBe(true);
    });

    it('throws ConflictException when email already exists', async () => {
      // Prisma unique constraint violation code
      prismaMock.user.create.mockRejectedValue({ code: 'P2002' });

      await expect(service.create(dto)).rejects.toThrow(ConflictException);
      await expect(service.create(dto)).rejects.toThrow('Email already in use');
    });

    it('re-throws unknown errors untouched', async () => {
      const dbError = new Error('Database connection lost');
      prismaMock.user.create.mockRejectedValue(dbError);

      await expect(service.create(dto)).rejects.toThrow('Database connection lost');
    });
  });
});
