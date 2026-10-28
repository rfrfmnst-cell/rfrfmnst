import { Module } from '@nestjs/common';

import { AppService } from './app.service';
import { AppController } from './app.controller';
import {
  DATABASE_POOL_FACTORY,
  DatabaseReadinessService,
  createProbePool,
} from './database-readiness';
import { ReadinessController } from './readiness.controller';

@Module({
  imports: [],
  controllers: [AppController, ReadinessController],
  providers: [
    AppService,
    DatabaseReadinessService,
    { provide: DATABASE_POOL_FACTORY, useValue: createProbePool },
  ],
})
export class AppModule {}
