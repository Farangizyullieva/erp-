import { IsBoolean, IsInt, IsOptional, IsString, IsTimeZone, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

export class CreateBranchDto {
  @IsString() @MinLength(2) @MaxLength(150) name!: string;
  /** Qisqartma — guruhlarni avtomatik nomlash uchun (TZ M1.1) */
  @Matches(/^[A-Za-z0-9-]{1,10}$/, { message: "code 1–10 ta lotin harfi, raqam yoki - bo'lishi kerak" })
  code!: string;
  @IsOptional() @IsString() @MaxLength(300) address?: string;
  @IsOptional() @IsString() @MaxLength(30) phone?: string;
  @IsOptional() @IsString() @MaxLength(100) working_hours?: string;
  @IsOptional() @IsTimeZone() timezone?: string;
}

export class UpdateBranchDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(150) name?: string;
  @IsOptional() @Matches(/^[A-Za-z0-9-]{1,10}$/) code?: string;
  @IsOptional() @IsString() @MaxLength(300) address?: string;
  @IsOptional() @IsString() @MaxLength(30) phone?: string;
  @IsOptional() @IsString() @MaxLength(100) working_hours?: string;
  @IsOptional() @IsTimeZone() timezone?: string;
  @IsOptional() @IsBoolean() is_active?: boolean;
}

export class CreateClassroomDto {
  @IsString() @MinLength(1) @MaxLength(100) name!: string;
  @IsInt() @Min(1) @Max(1000) capacity!: number;
  @IsOptional() @IsString() @MaxLength(500) equipment?: string;
}

export class UpdateClassroomDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(100) name?: string;
  @IsOptional() @IsInt() @Min(1) @Max(1000) capacity?: number;
  @IsOptional() @IsString() @MaxLength(500) equipment?: string;
  @IsOptional() @IsBoolean() is_active?: boolean;
}
