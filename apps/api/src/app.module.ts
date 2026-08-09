import { Module } from '@nestjs/common';
import { ApiController } from './api.controller.js';
import { ApiService } from './api.service.js';
import { AuthGuard } from './auth.js';
import { dbProvider } from './db.provider.js';

@Module({
  controllers: [ApiController],
  providers: [dbProvider, ApiService, AuthGuard],
})
export class AppModule {}
