import { Role } from '../../auth/enums/role.enum';

export class UserResponseDto {
  id: number;
  email: string;
  name: string;
  role: Role;
  createdAt: Date;
}
