import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { RequirePermission } from '../../common/auth/decorators';
import { CreateRoleDto, SetRolePermissionsDto, UpdateRoleDto } from './dto/roles.dto';
import { RolesService } from './roles.service';

@Controller()
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @RequirePermission('role.manage')
  @Get('permissions')
  catalog() {
    return this.roles.catalog();
  }

  // Xodim yaratish formasida rol tanlash uchun employee.* ruxsatlari ham yetarli
  @RequirePermission('role.manage', 'employee.view')
  @Get('roles')
  list() {
    return this.roles.list();
  }

  @RequirePermission('role.manage')
  @Get('roles/:id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.roles.get(id);
  }

  @RequirePermission('role.manage')
  @Post('roles')
  create(@Body() dto: CreateRoleDto) {
    return this.roles.create(dto);
  }

  @RequirePermission('role.manage')
  @Patch('roles/:id')
  rename(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateRoleDto) {
    return this.roles.rename(id, dto);
  }

  @RequirePermission('role.manage')
  @Put('roles/:id/permissions')
  setPermissions(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetRolePermissionsDto) {
    return this.roles.setPermissions(id, dto.permissions);
  }
}
