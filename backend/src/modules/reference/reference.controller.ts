import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { Authenticated, RequirePermission } from '../../common/auth/decorators';
import { CreateDictionaryItemDto, CreateHolidayDto, DictionaryQuery, HolidayQuery, UpdateDictionaryItemDto } from './reference.dto';
import { ReferenceService } from './reference.service';

@Controller()
export class ReferenceController {
  constructor(private readonly reference: ReferenceService) {}

  // Ma'lumotnomalar har bir formadagi select'lar uchun kerak — o'qish barcha xodimlarga ochiq
  @Authenticated()
  @Get('dictionaries')
  listItems(@Query() query: DictionaryQuery) {
    return this.reference.listItems(query);
  }

  @RequirePermission('settings.manage')
  @Post('dictionaries')
  createItem(@Body() dto: CreateDictionaryItemDto) {
    return this.reference.createItem(dto);
  }

  @RequirePermission('settings.manage')
  @Patch('dictionaries/:id')
  updateItem(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateDictionaryItemDto) {
    return this.reference.updateItem(id, dto);
  }

  @Authenticated()
  @Get('holidays')
  listHolidays(@Query() query: HolidayQuery) {
    return this.reference.listHolidays(query.year);
  }

  @RequirePermission('settings.manage')
  @Post('holidays')
  createHoliday(@Body() dto: CreateHolidayDto) {
    return this.reference.createHoliday(dto);
  }

  @RequirePermission('settings.manage')
  @Delete('holidays/:id')
  @HttpCode(204)
  deleteHoliday(@Param('id', ParseUUIDPipe) id: string) {
    return this.reference.deleteHoliday(id);
  }
}
