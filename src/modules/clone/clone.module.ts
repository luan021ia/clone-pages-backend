import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CloneController } from './clone.controller';
import { CloneService } from './clone.service';
import { CloneHistoryService } from './clone-history.service';
import { TrackingCleanerService } from './tracking-cleaner.service';
import { ExportService } from './export.service';
import { CloneHistory } from '../../database/entities/clone-history.entity';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([CloneHistory]),
    UsersModule,
  ],
  controllers: [CloneController],
  providers: [CloneService, CloneHistoryService, TrackingCleanerService, ExportService],
  exports: [CloneService, ExportService],
})
export class CloneModule {}

