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
import { InventoryService } from './inventory.service';
import { CreateInventoryDto } from './dto/create-inventory.dto';
import { UpdateInventoryDto } from './dto/update-inventory.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

@UseGuards(JwtAuthGuard)
@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Post()
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateInventoryDto,
  ) {
    const item = await this.inventoryService.create(user.id, dto);
    return {
      message: 'Product added to inventory',
      data: item,
    };
  }

  @Get()
  async findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: PaginationQueryDto,
  ) {
    const result = await this.inventoryService.findAll(
      user.id,
      query.page,
      query.limit,
      query.search,
    );
    return {
      message: 'Inventory retrieved',
      data: result.data,
      meta: result.meta,
    };
  }

  @Get(':id')
  async findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    const item = await this.inventoryService.findOne(user.id, id);
    return {
      message: 'Product retrieved',
      data: item,
    };
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateInventoryDto,
  ) {
    const updated = await this.inventoryService.update(user.id, id, dto);
    return {
      message: 'Product updated successfully',
      data: updated,
    };
  }

  @Delete(':id')
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    const result = await this.inventoryService.remove(user.id, id);
    return {
      message: 'Product removed from inventory',
      data: result,
    };
  }
}
