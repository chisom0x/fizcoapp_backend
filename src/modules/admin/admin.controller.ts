import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminGuard } from './admin.guard';
import { AdminService } from './admin.service';
import {
  AdminListQueryDto,
  AdminUpdateUserDto,
  RangeQueryDto,
  RequestsQueryDto,
  SubscriptionsQueryDto,
  TransactionsQueryDto,
  UsersQueryDto,
} from './dto/admin.dto';

const Id = () => Param('id', new ParseUUIDPipe());

@Controller('admin')
@UseGuards(AdminGuard)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('dashboard')
  dashboard(@Query() q: RangeQueryDto) {
    return this.adminService.dashboard(q);
  }

  @Get('analytics')
  analytics(@Query() q: RangeQueryDto) {
    return this.adminService.analytics(q);
  }

  @Get('users')
  listUsers(@Query() q: UsersQueryDto) {
    return this.adminService.listUsers(q);
  }

  @Get('users/:id')
  getUser(@Id() id: string) {
    return this.adminService.getUser(id);
  }

  @Patch('users/:id')
  updateUser(@Id() id: string, @Body() dto: AdminUpdateUserDto) {
    return this.adminService.updateUser(id, dto);
  }

  @Delete('users/:id')
  deleteUser(@Id() id: string) {
    return this.adminService.deleteUser(id);
  }

  @Get('users/:id/requests')
  userRequests(@Id() id: string, @Query() q: AdminListQueryDto) {
    return this.adminService.userRequests(id, q);
  }

  @Get('users/:id/interests')
  userInterests(@Id() id: string, @Query() q: AdminListQueryDto) {
    return this.adminService.userInterests(id, q);
  }

  @Get('users/:id/inventory')
  userInventory(@Id() id: string, @Query() q: AdminListQueryDto) {
    return this.adminService.userInventory(id, q);
  }

  @Get('users/:id/transactions')
  userTransactions(@Id() id: string, @Query() q: AdminListQueryDto) {
    return this.adminService.userTransactions(id, q);
  }

  @Get('requests')
  listRequests(@Query() q: RequestsQueryDto) {
    return this.adminService.listRequests(q);
  }

  @Get('requests/:id')
  getRequest(@Id() id: string) {
    return this.adminService.getRequest(id);
  }

  @Delete('requests/:id')
  deleteRequest(@Id() id: string) {
    return this.adminService.deleteRequest(id);
  }

  @Get('finance')
  finance(@Query() q: RangeQueryDto) {
    return this.adminService.finance(q);
  }

  @Get('finance/transactions')
  listTransactions(@Query() q: TransactionsQueryDto) {
    return this.adminService.listTransactions(q);
  }

  @Get('finance/transactions/:id')
  getTransaction(@Id() id: string) {
    return this.adminService.getTransaction(id);
  }

  @Get('finance/subscriptions')
  listSubscriptions(@Query() q: SubscriptionsQueryDto) {
    return this.adminService.listSubscriptions(q);
  }
}
