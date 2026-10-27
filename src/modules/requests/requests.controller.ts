import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { RequestsService } from './requests.service';
import { CreateRequestDto } from './dto/create-request.dto';
import { UpdateRequestDto } from './dto/update-request.dto';
import { FulfillRequestDto } from './dto/fulfill-request.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

@UseGuards(JwtAuthGuard)
@Controller('requests')
export class RequestsController {
  constructor(private readonly requestsService: RequestsService) {}

  @Post()
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateRequestDto,
  ) {
    const request = await this.requestsService.create(user.id, dto);
    return {
      message: 'Request created successfully',
      data: request,
    };
  }

  @Get('open')
  async getOpenRequests(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: PaginationQueryDto,
  ) {
    const result = await this.requestsService.getOpenRequests(
      user.id,
      query.page,
      query.limit,
      query.search,
    );
    return {
      message: 'Open requests retrieved',
      data: result.data,
      meta: result.meta,
    };
  }

  @Get('my-requests')
  async getMyRequests(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: PaginationQueryDto,
  ) {
    const result = await this.requestsService.getMyRequests(
      user.id,
      query.page,
      query.limit,
    );
    return {
      message: 'My requests retrieved',
      data: result.data,
      meta: result.meta,
    };
  }

  @Get(':id')
  async getRequestById(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    const request = await this.requestsService.getRequestById(id);
    return {
      message: 'Request retrieved',
      data: request,
    };
  }

  @Post(':id/chat')
  async openChat(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    const result = await this.requestsService.openChat(id, user.id);
    return {
      message: 'Chat opened',
      data: result,
    };
  }

  @Post(':id/interest')
  async showInterest(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    const result = await this.requestsService.showInterest(
      id,
      user.id,
      user.fullName,
    );
    return {
      message: 'Interest recorded successfully',
      data: result,
    };
  }

  @Patch(':id/fulfill')
  async fulfill(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: FulfillRequestDto,
  ) {
    const result = await this.requestsService.fulfill(id, user.id, dto);
    return {
      message: 'Request marked as fulfilled',
      data: result,
    };
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateRequestDto,
  ) {
    const result = await this.requestsService.update(id, user.id, dto);
    return {
      message: 'Request updated successfully',
      data: result,
    };
  }

  @Delete(':id')
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    const result = await this.requestsService.remove(id, user.id);
    return {
      message: 'Request deleted successfully',
      data: result,
    };
  }
}
