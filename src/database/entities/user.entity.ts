import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm'

@Entity('users')
@Unique(['email'])
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string

  @Column({ length: 120 })
  name!: string

  @Column({ length: 180 })
  email!: string

  @Column({ select: false })
  password!: string

  @Column({ type: 'varchar', length: 20, default: 'user' })
  role!: 'user' | 'admin'

  @Column({ type: 'varchar', length: 14, nullable: true })
  cpf?: string

  @Column({ type: 'varchar', length: 20, nullable: true })
  phone?: string

  @Column({ type: 'varchar', length: 36, nullable: true })
  currentSessionId?: string

  @CreateDateColumn()
  createdAt!: Date
}