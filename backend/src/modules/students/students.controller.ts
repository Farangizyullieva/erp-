import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { RequirePermission } from '../../common/auth/decorators';
import { ContactPersonDto, CreateStudentDto, StudentQuery, UpdateContactPersonDto, UpdateStudentDto } from './students.dto';
import { StudentsService } from './students.service';

@Controller('students')
export class StudentsController {
  constructor(private readonly students: StudentsService) {}

  @RequirePermission('student.view')
  @Get()
  list(@Query() query: StudentQuery) {
    return this.students.list(query);
  }

  @RequirePermission('student.create')
  @Post()
  create(@Body() dto: CreateStudentDto) {
    return this.students.create(dto);
  }

  @RequirePermission('student.view')
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.students.get(id);
  }

  @RequirePermission('student.update')
  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateStudentDto) {
    return this.students.update(id, dto);
  }

  @RequirePermission('student.archive')
  @Post(':id/archive')
  @HttpCode(200)
  archive(@Param('id', ParseUUIDPipe) id: string) {
    return this.students.setArchived(id, true);
  }

  @RequirePermission('student.archive')
  @Post(':id/unarchive')
  @HttpCode(200)
  unarchive(@Param('id', ParseUUIDPipe) id: string) {
    return this.students.setArchived(id, false);
  }

  @RequirePermission('student.view')
  @Get(':id/history')
  history(@Param('id', ParseUUIDPipe) id: string) {
    return this.students.history(id);
  }

  @RequirePermission('student.update')
  @Post(':id/contacts')
  addContact(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ContactPersonDto) {
    return this.students.addContact(id, dto);
  }

  @RequirePermission('student.update')
  @Patch(':id/contacts/:contactId')
  updateContact(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('contactId', ParseUUIDPipe) contactId: string,
    @Body() dto: UpdateContactPersonDto,
  ) {
    return this.students.updateContact(id, contactId, dto);
  }

  @RequirePermission('student.update')
  @Delete(':id/contacts/:contactId')
  @HttpCode(204)
  removeContact(@Param('id', ParseUUIDPipe) id: string, @Param('contactId', ParseUUIDPipe) contactId: string) {
    return this.students.removeContact(id, contactId);
  }
}
