import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { Authenticated, RequirePermission } from '../../common/auth/decorators';
import { CreateEmployeeDto, EmployeeQuery, UpdateEmployeeDto } from './dto/employees.dto';
import { EmployeesService } from './employees.service';

@Controller('employees')
export class EmployeesController {
  constructor(private readonly employees: EmployeesService) {}

  @RequirePermission('employee.view')
  @Get()
  list(@Query() query: EmployeeQuery) {
    return this.employees.list(query);
  }

  // Mas'ul xodimni tanlash uchun: faqat id va ism, employee.view talab qilinmaydi
  @Authenticated()
  @Get('options')
  options() {
    return this.employees.options();
  }

  @RequirePermission('employee.view')
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.employees.get(id);
  }

  @RequirePermission('employee.create')
  @Post()
  create(@Body() dto: CreateEmployeeDto) {
    return this.employees.create(dto);
  }

  @RequirePermission('employee.update')
  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateEmployeeDto) {
    return this.employees.update(id, dto);
  }

  @RequirePermission('employee.deactivate')
  @Post(':id/deactivate')
  @HttpCode(200)
  deactivate(@Param('id', ParseUUIDPipe) id: string) {
    return this.employees.setActive(id, false);
  }

  @RequirePermission('employee.deactivate')
  @Post(':id/activate')
  @HttpCode(200)
  activate(@Param('id', ParseUUIDPipe) id: string) {
    return this.employees.setActive(id, true);
  }
}
