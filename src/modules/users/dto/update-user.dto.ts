import { IsEmail, IsOptional, MinLength, IsIn } from 'class-validator'

export class UpdateUserDto {
  @IsOptional()
  name?: string

  @IsOptional()
  @IsEmail()
  email?: string

  @IsOptional()
  @MinLength(6)
  password?: string

  @IsOptional()
  @IsIn(['user', 'admin'])
  role?: 'user' | 'admin'

  @IsOptional()
  cpf?: string

  @IsOptional()
  phone?: string
}