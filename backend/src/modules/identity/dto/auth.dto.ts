import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  /** Telefon yoki email */
  @IsString() @MinLength(3) @MaxLength(255) login!: string;
  @IsString() @MinLength(1) @MaxLength(200) password!: string;
  @IsOptional() @IsString() @MaxLength(100) tenant?: string;
  /** 2FA yoqilgan bo'lsa — autentifikator ilovasidagi 6 xonali kod */
  @IsOptional() @Matches(/^\d{6}$/) totp_code?: string;
}

export class RefreshDto {
  @IsString() @MinLength(20) @MaxLength(300) refresh_token!: string;
}

export class PasswordDto {
  @IsString() @MinLength(1) @MaxLength(200) password!: string;
}

export class TotpCodeDto {
  @Matches(/^\d{6}$/, { message: "Kod 6 ta raqamdan iborat bo'lishi kerak" }) code!: string;
}

export class TotpDisableDto extends TotpCodeDto {
  @IsString() @MinLength(1) @MaxLength(200) password!: string;
}
