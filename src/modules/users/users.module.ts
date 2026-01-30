import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { User } from '../../database/entities/user.entity';
import { UsersService } from './services/users.service';
import { UsersController } from './controllers/users.controller';
import { UserRepository } from './repositories/user.repository';
import { LicensesModule } from '../licenses/licenses.module';
import { SessionGuard } from '../../common/guards/session.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([User]),
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'your-secret-key',
      signOptions: { expiresIn: '24h' },
    }),
    LicensesModule,
  ],
  providers: [
    UsersService,
    { provide: 'IUserRepository', useClass: UserRepository },
    SessionGuard,
  ],
  controllers: [UsersController],
  exports: [SessionGuard, UsersService, JwtModule, 'IUserRepository'],
})
export class UsersModule {}