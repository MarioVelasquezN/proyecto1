# Reporte de Análisis — Backend NestJS E-Commerce

---

## 1. Estructura del Proyecto

### Árbol de módulos

```
src/
├── main.ts                        ← bootstrap: Helmet, CORS, ValidationPipe
├── app.module.ts                  ← raíz: imports globales, interceptors, guards
│
├── prisma/                        ← PrismaService (singleton global)
├── auth/                          ← JWT + refresh token + guards + decorators
│   ├── guards/          jwt-auth.guard.ts, roles.guard.ts
│   ├── decorators/      current-user.decorator.ts, roles.decorator.ts
│   ├── interfaces/      jwt-payload.interface.ts
│   ├── enums/           role.enum.ts
│   └── helpers/         map-prisma-role.ts              ← conversión PrismaRole→AppRole
├── users/                         ← CRUD usuario, UserResponseDto
├── products/                      ← CRUD + paginación + búsqueda
├── categories/                    ← catálogo plano
├── cart/                          ← carrito por usuario (upsert)
├── checkout/                      ← orquestador: Cart→Stock→Orders
├── orders/                        ← ciclo de vida de órdenes + state machine
│   └── order-state-machine.ts     ← transiciones de estado centralizadas
├── stock/                         ← fuente única de verdad del stock
├── inventory/                     ← stubs de compatibilidad → re-exporta Stock
├── coupons/                       ← descuentos por código
├── health/                        ← liveness check
└── common/
    ├── audit/           AuditInterceptor + AuditService (DB persistence)
    ├── logging/         LoggingInterceptor (niveles info/warn/error)
    └── middleware/      audit.middleware.ts, logger.middleware.ts (no-op stubs)
```

### Capas por módulo

| Capa | Implementación |
|---|---|
| **Controllers** | Validan roles, extraen `@CurrentUser()`, delegan al service |
| **Services** | Toda la lógica de negocio; únicas que tocan Prisma o servicios externos |
| **DTOs** | Entrada validada con `class-validator`; salida tipada con interfaces |
| **Prisma** | Un único `PrismaService` compartido; sin repositorios intermedios |
| **Guards** | `JwtAuthGuard` (autenticación), `RolesGuard` (autorización) |
| **Interceptors** | `AuditInterceptor` (persistencia de auditoría), `LoggingInterceptor` (logs HTTP) |
| **Decorators** | `@CurrentUser()`, `@Roles()` |

---

## 2. Arquitectura

### Patrón adoptado

**Layered Architecture** con elementos de **Clean Separation of Concerns** — no DDD ni hexagonal formal, pero con fronteras de módulo bien definidas.

### Flujo de request

```
HTTP Request
  │
  ├─ Helmet (headers de seguridad)
  ├─ CORS (origin whitelist)
  ├─ ThrottlerGuard (rate limit 100 req/15min)
  ├─ ValidationPipe (whitelist + transform + forbidNonWhitelisted)
  │
  ├─ LoggingInterceptor (inicio del timer)
  ├─ AuditInterceptor (captura método/endpoint/body sanitizado)
  │
  ├─ JwtAuthGuard (verifica Bearer token, inyecta user en request)
  ├─ RolesGuard (verifica requiredRoles vs user.role)
  │
  ├─ Controller (extrae parámetros, llama al service)
  ├─ Service (lógica de negocio, llama a Prisma / otros services)
  ├─ PrismaService → MySQL
  │
  └─ LoggingInterceptor (escribe log con statusCode + responseTime)
       AuditInterceptor (persiste en AuditLog vía finalize)
```

### Grafo de dependencias entre módulos

```
AppModule
  ├── AuditModule (@Global)  ← cualquier módulo puede inyectar AuditService
  ├── LoggingModule (@Global)
  ├── CheckoutModule
  │     ├── CartModule       ← lee carrito, limpia carrito
  │     ├── StockModule      ← decrementa stock
  │     └── OrdersModule     ← persiste la orden (persist())
  ├── OrdersModule
  │     └── StockModule
  ├── CartModule             ← independiente (solo PrismaService)
  ├── StockModule            ← independiente
  └── InventoryModule        ← stubs → re-exporta StockModule (backward compat)
```

**Separación de responsabilidades:**
- **Cart** no conoce Orders ni Checkout
- **Orders** no conoce Cart
- **Checkout** es la única capa de coordinación entre los tres
- **Stock** es la única autoridad para decrementar stock (`decreaseMany`)

---

## 3. Seguridad

### Autenticación

- **JWT Access Token** firmado con `JWT_ACCESS_SECRET`, TTL 15 min
- **Refresh Token** opaco (64 bytes hex, 128 caracteres), almacenado en BD
- **Rotación de refresh token**: cada uso estampa `usedAt` y emite uno nuevo
- **Detección de reuso**: si llega un token ya usado (`usedAt != null`) → se revocan TODAS las sesiones del usuario (`deleteMany`) — protección contra robo de token

### Autorización

- `RolesGuard` basado en Reflector + metadatos `@Roles()`
- Dos roles: `user` (cliente) y `admin` (backoffice)
- `FindOne` de Orders usa `NotFoundException` en lugar de `ForbiddenException` para no revelar la existencia de órdenes de otros usuarios

### Seguridad de red y entrada

| Mecanismo | Configuración |
|---|---|
| **Helmet** | Todos los headers de seguridad por defecto |
| **CORS** | Origin configurable por `ALLOWED_ORIGINS` env var |
| **ThrottlerGuard** | 100 req / 15 min global (configurable) |
| **ValidationPipe** | `whitelist: true`, `forbidNonWhitelisted: true`, `transform: true` |
| **bcrypt** | `saltRounds = 10` (estándar seguro) |

### Auditoría

- `AuditInterceptor` global: registra POST/PUT/PATCH/DELETE con userId, endpoint, body sanitizado
- Sanitización elimina: `password`, `currentPassword`, `newPassword`, `token`, `refreshToken`, `accessToken`, `secret`
- Fire-and-forget: un fallo en auditoría nunca afecta la respuesta al cliente

### Vulnerabilidades identificadas

| Vulnerabilidad | Riesgo | Estado |
|---|---|---|
| Refresh token almacenado en texto plano en BD | **Alto** | Pendiente — debería guardarse como hash (SHA-256) |
| `CORS credentials: true` sin validación explícita de origin | **Medio** | Depende de `ALLOWED_ORIGINS` en producción |
| No hay limit en cantidad de items del carrito | **Bajo** | Posible abuso para inflar payload |
| `CouponsService.findAll()` no paginada ni autenticada | **Bajo** | Expone todos los cupones (incluyendo inactivos/expirados) |
| JWT sin lista de revocación para access tokens | **Bajo** | Estándar en JWT; mitigado por TTL corto de 15 min |

---

## 4. Modelo de Datos

### Entidades y relaciones

```
User (1) ──────────────── (N) RefreshToken
User (1) ──────────────── (N) Order
User (1) ──────────────── (N) Product (createdBy)
User (1) ──────────────── (1) Cart

Cart (1) ───────────────── (N) CartItem
CartItem (N) ──────────── (1) Product

Order (1) ──────────────── (N) OrderItem
Order (N) ──────────────── (1) Coupon (nullable)
OrderItem (N) ──────────── (1) Product

Product (N) ────────────── (1) Category

AuditLog (sin FK)          ← se preserva aunque el usuario sea borrado
```

### Integridad y diseño

- **ON DELETE CASCADE**: Cart→User, Order→User, CartItem→Cart, OrderItem→Order, RefreshToken→User
- **ON DELETE Restrict** (default MySQL): Product no puede borrarse si hay CartItems u OrderItems activos
- **Stock** vive en `Product.stock` — fuente única de verdad, solo modificable por `StockService.decreaseMany()`
- **Price snapshot**: `OrderItem.price` captura el precio al momento de compra, independiente de cambios futuros al producto
- **AuditLog.userId** es `String` (no FK) — los logs sobreviven la eliminación del usuario

### Enums del schema

| Enum | Valores | Uso |
|---|---|---|
| `Role` | `user`, `admin` | Control de acceso |
| `OrderStatus` | `pending`, `paid`, `cancelled`, `delivered` | State machine de órdenes |

### State Machine de Órdenes

```
pending ──→ paid ──→ delivered  (estado final: sin transiciones)
    └────→ cancelled             (estado final: sin transiciones)

Transiciones bloqueadas:
  paid → pending (retroceso)
  paid → cancelled
  delivered → cualquier estado
  cancelled → cualquier estado
```

---

## 5. Patrones de Concurrencia y Transacciones

### Guard atómico TOCTOU (anti-overselling)

```sql
-- En StockService.decreaseOne():
UPDATE product
SET stock = stock - :qty
WHERE id = :productId AND stock >= :qty
-- InnoDB: row-level lock serializa writes concurrentes a la misma fila
```

Si `updated.count === 0` → `ConflictException` (409) → rollback de la transacción padre.

### Flujo transaccional del checkout

```
prisma.$transaction(async tx => {
  1. StockService.decreaseMany(items, tx)  ← atomic decrements, may throw 409
  2. OrdersService.persist(tx, ...)         ← inserta Order + OrderItems
  3. CartService.clear(cartId, tx)          ← vacía el carrito
})
-- Si cualquiera de los 3 falla → rollback total (InnoDB)
```

### Pre-validación fuera de transacción

`CheckoutService` hace un pre-check de stock antes de abrir la transacción para mensajes de error descriptivos. El guard atómico dentro de la tx es el que realmente previene el overselling — el pre-check es UX, no seguridad.

### Escenarios de concurrencia cubiertos por E2E

| Escenario | Stock | Compradores | Qty/c | Éxitos esperados |
|---|---|---|---|---|
| 1 — demanda 2× oferta | 5 | 10 | 1 | 5 |
| 2 — qty > 1 | 9 | 5 | 3 | 3 |
| 3 — demand == supply | 4 | 4 | 1 | 4 |

---

## 6. Testing

### Cobertura actual: 23 suites, 262 tests unitarios

| Módulo | Tests | Qué cubre |
|---|---|---|
| `OrderStateMachine` | 22 | Transiciones válidas/inválidas, mensajes, centralización |
| `CheckoutService` | ~28 | Orquestación, cupones, TOCTOU, carrito vacío |
| `OrdersService` | ~56 | CRUD, persist(), state machine, stock delegation |
| `CartService` | ~15 | add/get/remove, getForCheckout, clear |
| `StockService` | ~12 | decreaseMany, TOCTOU concurrency mock |
| `AuditInterceptor` | 13 | Sanitización, métodos cubiertos, fire-and-forget |
| `LoggingInterceptor` | 17 | Niveles, responseTime, no-body logging |
| `AuthService` | 12 | login, register, refresh, reuse detection |
| `UsersService` | 4 | create, hash, errores |
| `mapPrismaRole` | 8 | Mapeos, rol desconocido, simetría |

### E2E Tests (requieren DB real)

```
test/
├── app.e2e-spec.ts           ← smoke test de bootstrap
├── auth.e2e-spec.ts          ← register/login/refresh/reuse
├── products.e2e-spec.ts      ← CRUD con auth
├── inventory.e2e-spec.ts     ← stock API
├── flow.e2e-spec.ts          ← flujo completo: register→product→cart→checkout→order
├── checkout-flow.e2e-spec.ts ← checkout con cupones
└── concurrency.e2e-spec.ts   ← 3 escenarios de overselling con Promise.all
```

**Fortalezas:**
- Tests de concurrencia reales sobre MySQL (no mocks)
- `db-cleaner.ts` respeta el orden de FK para limpiezas seguras
- Unit tests usan mocks estructurados sin `jest.mock()` global
- Separación clara de fixtures reutilizables

**Debilidades:**
- No hay tests de `ProductsService.findAll()` con paginación y filtros
- No hay tests E2E para flujo completo de roles de admin
- `CouponsService` solo tiene 2 tests básicos
- No hay tests de `HealthService`

---

## 7. Dependencias

### Producción

| Paquete | Versión | Propósito |
|---|---|---|
| `@nestjs/common`, `core`, `platform-express` | ^10.4 | Framework principal |
| `@nestjs/jwt` | ^10.2 | Firma y verificación de JWT |
| `@nestjs/throttler` | ^6.2 | Rate limiting |
| `@nestjs/config` | ^3.2 | Variables de entorno tipadas |
| `@prisma/client` | ^5.22 | ORM / query builder |
| `bcrypt` | ^5.1 | Hash de contraseñas |
| `helmet` | ^8.0 | Headers de seguridad HTTP |
| `rxjs` | ^7.8 | Observables (interceptors) |
| `class-validator` + `class-transformer` | ^0.14 / ^0.5 | Validación de DTOs |

### Sin dependencias redundantes significativas

- No hay `passport` — JWT guard implementado a mano (más simple, más código propio)
- No hay `@nestjs/swagger` — sin documentación OpenAPI
- No hay `winston` ni `pino` — logging propio con `Logger` de NestJS

---

## 8. Problemas Resueltos

| Problema | Solución aplicada |
|---|---|
| `Prisma.$Enums.Role` incompatible con `AppRole` | `mapPrismaRole()` en `auth/helpers/` |
| Lógica de stock dispersa en Checkout + Orders + Inventory | `StockService` como fuente única; `decreaseMany(tx)` acepta tx del caller |
| Auditoría en middleware (sincrona, sin body) | `AuditInterceptor` global con `finalize()` y sanitización |
| Logging con formato plano en middleware | `LoggingInterceptor` con niveles info/warn/error y JSON estructurado |
| Transiciones de estado inline en `OrdersService` | `OrderStateMachine` con switch exhaustivo |
| `CheckoutService` creaba órdenes con `tx.order.create` directo | Delegado a `OrdersService.persist()` |
| `CheckoutService` leía el carrito con Prisma directo | Delegado a `CartService.getForCheckout()` |
| `InventoryModule` duplicaba lógica de stock | Convertido a stub que re-exporta `StockModule` |
| Bug TS2345 en `it.each` con tuplas de 3 elementos | Añadido parámetro `_label` en callbacks |

---

## 9. Recomendaciones de Mejora

### Seguridad (prioridad alta)

```typescript
// Refresh token: hashear antes de guardar en BD
const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
await this.prisma.refreshToken.create({ data: { token: tokenHash, ... } });
// Al verificar: hashear el token recibido y comparar contra el hash
```

```typescript
// Validar sortBy contra lista blanca de columnas permitidas
@IsIn(['name', 'price', 'createdAt', 'stock'])
@IsOptional()
sortBy?: string;
```

### Arquitectura

- **Añadir `@nestjs/swagger`**: los DTOs ya tienen decorators de `class-validator`; la migración es mínima y un backend de producción necesita documentación de API.
- **Separar `validateCoupon` a `CouponsService`**: actualmente está en `CheckoutService` con acceso directo a Prisma — viola la separación de responsabilidades.
- **Paginación en `OrdersService.findAll()`**: sin paginación, la query escala lineal con el volumen de órdenes.

### Base de Datos

- **Índice en `OrderItem.productId`**: las queries de stock y auditoría filtran por `productId` pero el schema no tiene índice explícito.
- **Índice Full-Text en `Product.name`**: `findAll` usa `{ name: { contains: search } }` — en MySQL esto no usa índice B-Tree si el patrón empieza con `%`.
- **Soft delete en productos**: borrar un producto con `OrderItems` asociados falla por FK constraint (Restrict). Añadir `deletedAt DateTime?` y filtrar en queries.

### Testing

```typescript
// Añadir test de sortBy inválido en GetProductsDto
it('rechaza sortBy con valor no permitido', async () => {
  const errors = await validate(
    plainToInstance(GetProductsDto, { sortBy: 'password' })
  );
  expect(errors.length).toBeGreaterThan(0);
});
```

---

## 10. Resumen Ejecutivo

### Estado: MVP+ / Semi-Enterprise

Listo para producción de escala pequeña. Con brechas claras antes de escalar.

### Lo que funciona bien

- **Seguridad base sólida**: Helmet + CORS + Throttler + ValidationPipe + JWT + bcrypt correctamente configurados
- **Concurrencia resuelta**: el guard `WHERE stock >= qty` de InnoDB es la implementación correcta y está testeada con concurrencia real
- **Arquitectura de módulos limpia**: Cart, Orders y Checkout tienen fronteras claras con responsabilidades únicas
- **Auditoría y logging desacoplados**: interceptors globales, fire-and-forget, sin impacto en el flujo de negocio
- **State machine centralizada**: `OrderStateMachine` es el único punto de validación de transiciones
- **Testing de concurrencia real**: 3 escenarios E2E sobre MySQL validan la garantía de no-overselling
- **Tipado estricto**: `mapPrismaRole` resuelve el conflicto de enums Prisma vs TypeScript con tests de simetría

### Necesita atención inmediata

1. **Hash de refresh tokens en BD** — actualmente en texto plano; un dump de BD expone sesiones activas
2. **Paginación en `orders/findAll`** — query sin límite, riesgo de rendimiento con volumen real
3. **`sortBy` sin validación de lista blanca** — posible information leakage por columnas internas
4. **Documentación de API** — sin Swagger, el backend es opaco para equipos frontend o QA externos
