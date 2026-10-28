import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBooleanString, IsEmail, IsOptional, IsString, IsUUID, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { PageQuery } from '../../../common/utils/pagination';

export class CreateEmployeeDto {
  @IsString() @MinLength(2) @MaxLength(150) full_name!: string;
  @IsOptional() @IsString() @MaxLength(30) phone?: string;
  @IsOptional() @IsEmail() @MaxLength(255) email?: string;
  // Kamida 10 belgi (TZ 11.3)
  @IsString() @MinLength(10) @MaxLength(200) password!: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @IsUUID('all', { each: true }) role_ids!: string[];
  /** Bo'sh = barcha filiallar */
  @IsOptional() @IsArray() @ArrayMaxSize(200) @IsUUID('all', { each: true }) branch_ids?: string[];
}

export class UpdateEmployeeDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(150) full_name?: string;
  @IsOptional() @IsString() @MaxLength(30) phone?: string;
  @IsOptional() @IsEmail() @MaxLength(255) email?: string;
  @IsOptional() @IsString() @MinLength(10) @MaxLength(200) password?: string;
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @IsUUID('all', { each: true }) role_ids?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(200) @IsUUID('all', { each: true }) branch_ids?: string[];
}

export class EmployeeFilter {
  @IsOptional() @IsBooleanString() is_active?: string;
  @IsOptional() @IsUUID() branch_id?: string;
  @IsOptional() @IsUUID() role_id?: string;
}

export class EmployeeQuery extends PageQuery {
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @ValidateNested() @Type(() => EmployeeFilter) filter?: EmployeeFilter;
}
