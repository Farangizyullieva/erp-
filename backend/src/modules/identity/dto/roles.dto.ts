import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, Matches, MaxLength, MinLength, ValidateNested } from 'class-validator';

export class CreateRoleDto {
  @Matches(/^[a-z][a-z0-9_]{1,39}$/, { message: "code kichik lotin harflari, raqam va _ dan iborat bo'lishi kerak" })
  code!: string;
  @IsString() @MinLength(2) @MaxLength(100) name!: string;
  /** Mavjud roldan nusxalash (TZ 3.5) */
  @IsOptional() @IsString() copy_from_role_id?: string;
}

export class UpdateRoleDto {
  @IsString() @MinLength(2) @MaxLength(100) name!: string;
}

export class RolePermissionDto {
  @IsString() code!: string;
  @IsIn(['own', 'branch', 'all']) scope!: 'own' | 'branch' | 'all';
}

export class SetRolePermissionsDto {
  @IsArray() @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => RolePermissionDto)
  permissions!: RolePermissionDto[];
}
