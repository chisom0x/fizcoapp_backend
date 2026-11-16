import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { UsersModule } from '../users/users.module';
import { RequestsModule } from '../requests/requests.module';
import { AdminAuthController } from './admin-auth.controller';
import { AdminAuthService } from './admin-auth.service';
import { AdminController } from './admin.controller';
import { AdminGuard } from './admin.guard';
import { AdminRepository } from './admin.repository';
import { AdminService } from './admin.service';

/** The admin panel's API, under /v1/admin. Nothing in the mobile app's API depends on it */
@Module({
  imports: [JwtModule.register({}), UsersModule, RequestsModule],
  controllers: [AdminAuthController, AdminController],
  providers: [AdminAuthService, AdminGuard, AdminRepository, AdminService],
})
export class AdminModule {}
