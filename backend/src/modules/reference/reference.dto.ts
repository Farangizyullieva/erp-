import { Transform } from 'class-transformer';
import { IsBoolean, IsBooleanString, IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';

export const DICTIONARY_KINDS = [
  'discipline',
  'level',
  'age_category',
  'study_unit_type',
  'ad_source',
  'learning_goal',
  'cancel_reason',
] as const;
export type DictionaryKindCode = (typeof DICTIONARY_KINDS)[number];

const trim = ({ value }: { value: unknown }): unknown => (typeof value === 'string' ? value.trim() : value);

export class DictionaryQuery {
  @IsOptional() @IsIn(DICTIONARY_KINDS) kind?: DictionaryKindCode;
  @IsOptional() @IsBooleanString() include_inactive?: string;
}

export class CreateDictionaryItemDto {
  @IsIn(DICTIONARY_KINDS) kind!: DictionaryKindCode;
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(100) name!: string;
}

export class UpdateDictionaryItemDto {
  @IsOptional() @Transform(trim) @IsString() @MinLength(1) @MaxLength(100) name?: string;
  @IsOptional() @IsBoolean() is_active?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(10000) sort_order?: number;
}

export class HolidayQuery {
  @IsOptional() @Transform(({ value }) => Number(value)) @IsInt() @Min(2000) @Max(2100) year?: number;
}

export class CreateHolidayDto {
  @IsDateString({ strict: true }) date!: string;
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(100) name!: string;
  /** Ko'rsatilmasa — barcha filiallar uchun */
  @IsOptional() @IsUUID() branch_id?: string;
  @IsOptional() @IsBoolean() skip_lessons?: boolean;
}
