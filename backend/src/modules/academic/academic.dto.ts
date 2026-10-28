import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown => (typeof value === 'string' ? value.trim() : value);
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
export const UNIT_STATUSES = ['forming', 'active', 'paused', 'finished'] as const;
export const ATTENDANCE_STATUSES = ['present', 'late', 'absent_unexcused', 'absent_excused'] as const;

export class ScheduleDto {
  /** 1 = Dushanba … 7 = Yakshanba */
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(7) @ArrayUnique() @IsInt({ each: true }) @Min(1, { each: true }) @Max(7, { each: true }) days!: number[];
  @Matches(TIME) start_time!: string;
  @Matches(TIME) end_time!: string;
  @IsDateString({ strict: true }) period_start!: string;
  @IsDateString({ strict: true }) period_end!: string;
}

export class CreateStudyUnitDto {
  @Transform(trim) @IsString() @MinLength(2) @MaxLength(80) name!: string;
  @IsUUID() branch_id!: string;
  @IsUUID() discipline_id!: string;
  @IsOptional() @IsUUID() level_id?: string;
  @IsUUID() teacher_id!: string;
  @IsOptional() @IsUUID() classroom_id?: string;
  @IsInt() @Min(1) @Max(500) capacity!: number;
  /** Oylik abonement narxi, tiyinda */
  @IsInt() @Min(0) @Max(100_000_000_000) price_amount!: number;
  @IsOptional() @ValidateNested() @Type(() => ScheduleDto) schedule?: ScheduleDto;
}

export class UpdateStudyUnitDto {
  @IsOptional() @Transform(trim) @IsString() @MinLength(2) @MaxLength(80) name?: string;
  @IsOptional() @IsUUID() teacher_id?: string;
  @IsOptional() @Transform(({ value }) => (value === '' ? null : value)) @IsUUID() classroom_id?: string | null;
  @IsOptional() @IsInt() @Min(1) @Max(500) capacity?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100_000_000_000) price_amount?: number;
  @IsOptional() @IsIn(UNIT_STATUSES) status?: (typeof UNIT_STATUSES)[number];
}

export class StudyUnitQuery {
  @IsOptional() @Transform(trim) @IsString() @MaxLength(80) q?: string;
  @IsOptional() @IsUUID() branch_id?: string;
  @IsOptional() @IsIn(UNIT_STATUSES) status?: (typeof UNIT_STATUSES)[number];
}

export class AddMemberDto {
  @IsUUID() student_id!: string;
  @IsOptional() @IsDateString({ strict: true }) start_date?: string;
}

export class LessonQuery {
  @IsDateString({ strict: true }) from!: string;
  @IsDateString({ strict: true }) to!: string;
  @IsOptional() @IsUUID() branch_id?: string;
  @IsOptional() @IsUUID() teacher_id?: string;
  @IsOptional() @IsUUID() study_unit_id?: string;
}

export class CreateLessonDto {
  @IsUUID() study_unit_id!: string;
  @IsDateString({ strict: true }) date!: string;
  @Matches(TIME) start_time!: string;
  @Matches(TIME) end_time!: string;
}

export class CancelLessonDto {
  @Transform(trim) @IsString() @MinLength(2) @MaxLength(200) reason!: string;
}

class AttendanceEntryDto {
  @IsUUID() student_id!: string;
  @IsIn(ATTENDANCE_STATUSES) status!: (typeof ATTENDANCE_STATUSES)[number];
}

export class SaveAttendanceDto {
  @IsArray() @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => AttendanceEntryDto) entries!: AttendanceEntryDto[];
  /** Darsni yakunlangan deb belgilash */
  @IsOptional() @IsBoolean() complete?: boolean;
}

export class AttendanceOverviewQuery {
  @IsOptional() @IsDateString({ strict: true }) from?: string;
  @IsOptional() @IsDateString({ strict: true }) to?: string;
  @IsOptional() @IsUUID() branch_id?: string;
  @IsOptional() @IsUUID() study_unit_id?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(80) q?: string;
}

export class MatrixQuery {
  @IsUUID() study_unit_id!: string;
  @IsOptional() @IsDateString({ strict: true }) from?: string;
  @IsOptional() @IsDateString({ strict: true }) to?: string;
}
