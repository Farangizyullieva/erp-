import { Body, Controller, Delete, Get, HttpCode, Module, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { RequirePermission } from '../../common/auth/decorators';
import { AddMemberDto, AttendanceOverviewQuery, CancelLessonDto, CreateLessonDto, CreateStudyUnitDto, LessonQuery, MatrixQuery, SaveAttendanceDto, ScheduleDto, StudyUnitQuery, UpdateStudyUnitDto } from './academic.dto';
import { AcademicService } from './academic.service';

@Controller()
export class AcademicController {
  constructor(private readonly academic: AcademicService) {}

  @RequirePermission('study_unit.view', 'schedule.view')
  @Get('study-units')
  listUnits(@Query() query: StudyUnitQuery) {
    return this.academic.listUnits(query);
  }

  @RequirePermission('study_unit.create')
  @Post('study-units')
  createUnit(@Body() dto: CreateStudyUnitDto) {
    return this.academic.createUnit(dto);
  }

  @RequirePermission('study_unit.view')
  @Get('study-units/:id')
  getUnit(@Param('id', ParseUUIDPipe) id: string) {
    return this.academic.getUnit(id);
  }

  @RequirePermission('study_unit.update')
  @Patch('study-units/:id')
  updateUnit(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateStudyUnitDto) {
    return this.academic.updateUnit(id, dto);
  }

  @RequirePermission('schedule.create', 'schedule.update')
  @Put('study-units/:id/schedule')
  setSchedule(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ScheduleDto) {
    return this.academic.setSchedule(id, dto);
  }

  @RequirePermission('study_unit.manage_members')
  @Post('study-units/:id/members')
  addMember(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AddMemberDto) {
    return this.academic.addMember(id, dto);
  }

  @RequirePermission('study_unit.manage_members')
  @Delete('study-units/:id/members/:enrollmentId')
  @HttpCode(204)
  removeMember(@Param('id', ParseUUIDPipe) id: string, @Param('enrollmentId', ParseUUIDPipe) enrollmentId: string) {
    return this.academic.removeMember(id, enrollmentId);
  }

  @RequirePermission('schedule.view')
  @Get('lessons')
  listLessons(@Query() query: LessonQuery) {
    return this.academic.listLessons(query);
  }

  @RequirePermission('schedule.create')
  @Post('lessons')
  createLesson(@Body() dto: CreateLessonDto) {
    return this.academic.createLesson(dto);
  }

  @RequirePermission('lesson.cancel')
  @Post('lessons/:id/cancel')
  @HttpCode(200)
  cancelLesson(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelLessonDto) {
    return this.academic.cancelLesson(id, dto);
  }

  @RequirePermission('attendance.view')
  @Get('lessons/:id/attendance')
  getAttendance(@Param('id', ParseUUIDPipe) id: string) {
    return this.academic.getAttendance(id);
  }

  @RequirePermission('attendance.mark')
  @Put('lessons/:id/attendance')
  saveAttendance(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SaveAttendanceDto) {
    return this.academic.saveAttendance(id, dto);
  }

  @RequirePermission('attendance.view')
  @Get('students/:id/attendance')
  studentAttendance(@Param('id', ParseUUIDPipe) id: string, @Query('month') month?: string) {
    return this.academic.studentAttendance(id, month);
  }

  @RequirePermission('attendance.view')
  @Get('attendance/overview')
  overview(@Query() query: AttendanceOverviewQuery) {
    return this.academic.overview(query);
  }

  @RequirePermission('attendance.view')
  @Get('attendance/matrix')
  matrix(@Query() query: MatrixQuery) {
    return this.academic.matrix(query);
  }
}

@Module({ controllers: [AcademicController], providers: [AcademicService] })
export class AcademicModule {}
