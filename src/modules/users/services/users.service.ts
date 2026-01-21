import { Inject, Injectable } from '@nestjs/common'
import { IUserService } from '../interfaces/user-service.interface'
import { IUserRepository } from '../interfaces/user-repository.interface'
import { CreateUserDto } from '../dto/create-user.dto'
import { UpdateUserDto } from '../dto/update-user.dto'
import { User } from '../../../database/entities/user.entity'
import { hash, compare } from 'bcryptjs'

@Injectable()
export class UsersService implements IUserService {
  constructor(@Inject('IUserRepository') private readonly users: IUserRepository) {}

  async create(data: CreateUserDto): Promise<User> {
    const exists = await this.users.findByEmail(data.email)
    if (exists) throw new Error('Email already used')
    const password = await hash(data.password, 10)
    const name = data.name || data.email.split('@')[0] // Use email prefix if no name
    const role = data.role || 'user' // Default to user
    return this.users.create({ 
      name, 
      email: data.email, 
      password, 
      role,
      cpf: data.cpf,
      phone: data.phone
    })
  }

  async update(id: string, data: UpdateUserDto): Promise<User> {
    const patch: Partial<User> = {}
    if (data.name) patch.name = data.name
    if (data.email) patch.email = data.email
    if (data.password) patch.password = await hash(data.password, 10)
    if (data.role) patch.role = data.role
    if (data.cpf !== undefined) patch.cpf = data.cpf
    if (data.phone !== undefined) patch.phone = data.phone
    return this.users.update(id, patch)
  }

  async remove(id: string): Promise<void> {
    await this.users.delete(id)
  }

  async getById(id: string): Promise<User | null> {
    return this.users.findById(id)
  }

  async validate(email: string, plain: string): Promise<User | null> {
    const auth = await this.users.findAuthByEmail(email)
    if (!auth) return null
    const match = await compare(plain, auth.password)
    return match ? auth : null
  }

  async getAll(): Promise<User[]> {
    return this.users.findAll()
  }

  async updatePassword(id: string, password: string): Promise<User> {
    const hashedPassword = await hash(password, 10)
    return this.users.update(id, { password: hashedPassword })
  }

  async updateSessionId(id: string, sessionId: string): Promise<User> {
    return this.users.update(id, { currentSessionId: sessionId })
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.users.findByEmail(email)
  }
}