import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { SaveFcmTokenDto } from './dto/save-token.dto';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

@UseGuards(JwtAuthGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Post('token')
  async saveToken(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SaveFcmTokenDto,
  ) {
    await this.notificationsService.saveToken(user.id, dto.token);
    return {
      message: 'FCM token registered successfully',
    };
  }

  @Get()
  async getNotifications(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: PaginationQueryDto,
  ) {
    const result = await this.notificationsService.getUserNotifications(
      user.id,
      query.page,
      query.limit,
    );
    return {
      message: 'Notifications retrieved',
      data: result.data,
      meta: result.meta,
    };
  }

  @Patch(':id/read')
  async markRead(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    await this.notificationsService.markAsRead(id, user.id);
    return {
      message: 'Notification marked as read',
    };
  }

  @Patch('read-all')
  async markAllRead(@CurrentUser() user: AuthenticatedUser) {
    await this.notificationsService.markAllAsRead(user.id);
    return {
      message: 'All notifications marked as read',
    };
  }
}
