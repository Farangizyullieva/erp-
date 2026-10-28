import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { RequirePermission } from '../../common/auth/decorators';
import { BranchesService } from './branches.service';
import { CreateBranchDto, CreateClassroomDto, UpdateBranchDto, UpdateClassroomDto } from './dto/organization.dto';

@Controller()
export class BranchesController {
  constructor(private readonly branches: BranchesService) {}

  @RequirePermission('branch.view')
  @Get('branches')
  list() {
    return this.branches.list();
  }

  @RequirePermission('branch.view')
  @Get('branches/:id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.branches.get(id);
  }

  @RequirePermission('branch.create')
  @Post('branches')
  create(@Body() dto: CreateBranchDto) {
    return this.branches.create(dto);
  }

  @RequirePermission('branch.update')
  @Patch('branches/:id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateBranchDto) {
    return this.branches.update(id, dto);
  }

  @RequirePermission('branch.view')
  @Get('branches/:id/classrooms')
  listClassrooms(@Param('id', ParseUUIDPipe) id: string) {
    return this.branches.listClassrooms(id);
  }

  @RequirePermission('classroom.manage')
  @Post('branches/:id/classrooms')
  createClassroom(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateClassroomDto) {
    return this.branches.createClassroom(id, dto);
  }

  @RequirePermission('classroom.manage')
  @Patch('classrooms/:id')
  updateClassroom(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateClassroomDto) {
    return this.branches.updateClassroom(id, dto);
  }
}
