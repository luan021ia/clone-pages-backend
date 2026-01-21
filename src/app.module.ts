import { Module } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { TypeOrmModule } from '@nestjs/typeorm'
import { JwtModule } from '@nestjs/jwt'
import { User } from './database/entities/user.entity'
import { Task } from './database/entities/task.entity'
import { UsersModule } from './modules/users/users.module'
import { TasksModule } from './modules/tasks/tasks.module'
import { CloneModule } from './modules/clone/clone.module'
import { KiwifyModule } from './modules/webhooks/kiwify/kiwify.module'

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => {
        // Usar SQLite em todos os ambientes (dev e produção)
        // IMPORTANTE: Não usar 'url' para evitar que TypeORM detecte DATABASE_URL automaticamente
        const databaseFile = cfg.get<string>('SQLITE_DB') || 'saas-dev.sqlite'

        // Garantir que não estamos usando PostgreSQL - remover DATABASE_URL se existir
        if (process.env.DATABASE_URL) {
          delete process.env.DATABASE_URL
        }

        const config = {
          type: 'sqlite' as const,
          database: databaseFile,
          entities: [User, Task],
          synchronize: true,
          autoLoadEntities: true
        }


        return config
      }
    }),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        secret: cfg.get<string>('JWT_SECRET') || 'dev-secret',
        signOptions: { expiresIn: '7d' }
      })
    }),
    TypeOrmModule.forFeature([User, Task]),
    UsersModule,
    TasksModule,
    CloneModule,
    KiwifyModule
  ]
})
export class AppModule {}