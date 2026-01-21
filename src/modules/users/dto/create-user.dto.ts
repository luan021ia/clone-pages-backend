import { IsEmail, IsNotEmpty, MinLength, IsOptional, IsIn } from 'class-validator'

export class CreateUserDto {
  @IsOptional()
  name?: string

  @IsEmail()
  email!: string

  @MinLength(6)
  password!: string

  @IsOptional()
  @IsIn(['user', 'admin'])
  role?: 'user' | 'admin'

  @IsOptional()
  cpf?: string

  @IsOptional()
  phone?: string

  @IsOptional()
  licenseDays?: number
}