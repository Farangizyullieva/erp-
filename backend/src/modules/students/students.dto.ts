import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsEmail, IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength, ValidateNested,
} from 'class-validator';
import { PageQuery } from '../../common/utils/pagination';

const trim = ({ value }: { value: unknown }): unknown => (typeof value === 'string' ? value.trim() : value);
/** Bo'sh satr = "tozalash": PATCH'da maydonni null qilish imkonini beradi */
const emptyToNull = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' && value.trim() === '' ? null : typeof value === 'string' ? value.trim() : value;

export const STUDENT_STATUSES = ['new', 'active', 'paused', 'finished', 'archived'] as const;
export const GENDERS = ['male', 'female'] as const;

export class ContactPersonDto {
  @Transform(trim) @IsString() @MinLength(2) @MaxLength(150) full_name!: string;
  /** Ona, Ota, Vasiy ... */
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(50) relation!: string;
  @IsOptional() @Transform(emptyToNull) @IsString() @MaxLength(30) phone?: string | null;
  @IsOptional() @Transform(emptyToNull) @IsEmail() @MaxLength(255) email?: string | null;
  @IsOptional() @IsBoolean() is_bill_recipient?: boolean;
  @IsOptional() @IsBoolean() receives_notifications?: boolean;
}

export class UpdateContactPersonDto {
  @IsOptional() @Transform(trim) @IsString() @MinLength(2) @MaxLength(150) full_name?: string;
  @IsOptional() @Transform(trim) @IsString() @MinLength(1) @MaxLength(50) relation?: string;
  @IsOptional() @Transform(emptyToNull) @IsString() @MaxLength(30) phone?: string | null;
  @IsOptional() @Transform(emptyToNull) @IsEmail() @MaxLength(255) email?: string | null;
  @IsOptional() @IsBoolean() is_bill_recipient?: boolean;
  @IsOptional() @IsBoolean() receives_notifications?: boolean;
}

// "Minimal + keyin to'ldirish" (TZ P6): majburiy — faqat F.I.O. va filial
export class CreateStudentDto {
  @Transform(trim) @IsString() @MinLength(2) @MaxLength(150) full_name!: string;
  @IsUUID() branch_id!: string;
  @IsOptional() @Transform(emptyToNull) @IsString() @MaxLength(30) phone?: string | null;
  @IsOptional() @Transform(emptyToNull) @IsEmail() @MaxLength(255) email?: string | null;
  @IsOptional() @Transform(emptyToNull) @IsDateString({ strict: true }) birth_date?: string | null;
  @IsOptional() @Transform(emptyToNull) @IsIn(GENDERS) gender?: (typeof GENDERS)[number] | null;
  @IsOptional() @Transform(emptyToNull) @IsUUID() owner_id?: string | null;
  @IsOptional() @Transform(emptyToNull) @IsUUID() ad_source_id?: string | null;
  @IsOptional() @Transform(emptyToNull) @IsUUID() learning_goal_id?: string | null;
  @IsOptional() @Transform(emptyToNull) @IsString() @MaxLength(2000) note?: string | null;
  @IsOptional() @ValidateNested() @Type(() => ContactPersonDto) contact?: ContactPersonDto;
  /** Shu telefonli mijoz borligi haqidagi ogohlantirishdan keyin tasdiqlash */
  @IsOptional() @IsBoolean() confirm_duplicate?: boolean;
}

export class UpdateStudentDto {
  @IsOptional() @Transform(trim) @IsString() @MinLength(2) @MaxLength(150) full_name?: string;
  @IsOptional() @IsUUID() branch_id?: string;
  @IsOptional() @Transform(emptyToNull) @IsString() @MaxLength(30) phone?: string | null;
  @IsOptional() @Transform(emptyToNull) @IsEmail() @MaxLength(255) email?: string | null;
  @IsOptional() @Transform(emptyToNull) @IsDateString({ strict: true }) birth_date?: string | null;
  @IsOptional() @Transform(emptyToNull) @IsIn(GENDERS) gender?: (typeof GENDERS)[number] | null;
  @IsOptional() @Transform(emptyToNull) @IsUUID() owner_id?: string | null;
  @IsOptional() @Transform(emptyToNull) @IsUUID() ad_source_id?: string | null;
  @IsOptional() @Transform(emptyToNull) @IsUUID() learning_goal_id?: string | null;
  @IsOptional() @Transform(emptyToNull) @IsString() @MaxLength(2000) note?: string | null;
  @IsOptional() @IsIn(['uz', 'ru', 'en']) notification_language?: string;
  @IsOptional() @IsBoolean() blacklisted?: boolean;
  @IsOptional() @Transform(emptyToNull) @IsString() @MaxLength(500) blacklist_reason?: string | null;
}

export class StudentFilter {
  @IsOptional() @IsUUID() branch_id?: string;
  @IsOptional() @IsUUID() owner_id?: string;
  /** Vergul bilan: filter[status]=new,active */
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.split(',').filter(Boolean) : value))
  @IsArray() @ArrayMaxSize(5) @IsIn(STUDENT_STATUSES, { each: true })
  status?: (typeof STUDENT_STATUSES)[number][];
  @IsOptional() @IsIn(['true', 'false']) blacklisted?: string;
  /** Shu guruhda hozir o'qiyotganlar */
  @IsOptional() @IsUUID() study_unit_id?: string;
  /** Shu fan (kurs) bo'yicha hozir o'qiyotganlar */
  @IsOptional() @IsUUID() discipline_id?: string;
}

export class StudentQuery extends PageQuery {
  @IsOptional() @Transform(trim) @IsString() @MaxLength(100) q?: string;
  @IsOptional() @ValidateNested() @Type(() => StudentFilter) filter?: StudentFilter;
}
