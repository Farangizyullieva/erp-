import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Authenticated, CurrentUser, Public, Portal } from '../../common/auth/decorators';
import type { AuthContext } from '../../common/context/request-context';
import { PrismaService } from '../../common/db/prisma.service';
import { FilesService } from '../../common/files/files.service';
import { AuthService, TokenPair } from './auth.service';
import { LoginDto, PasswordDto, RefreshDto, TotpCodeDto, TotpDisableDto } from './dto/auth.dto';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly db: PrismaService,
    private readonly files: FilesService,
  ) {}

  // Akkaunt 5 ta xato urinishdan keyin 15 daqiqaga bloklanadi (AuthService). IP limiti muvaffaqiyatli kirishlarni ham
  // sanaydi, shuning uchun u kengroq: bitta ofis IP'si ortidagi xodimlar bir-birini bloklab qo'ymasligi kerak.
  @Public()
  @Throttle({ default: { limit: 30, ttl: 15 * 60_000 } })
  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto): Promise<TokenPair> {
    return this.auth.login(dto);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() dto: RefreshDto): Promise<TokenPair> {
    return this.auth.refresh(dto.refresh_token);
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  logout(@Body() dto: RefreshDto): Promise<void> {
    return this.auth.logout(dto.refresh_token);
  }

  @Authenticated()
  @Get('2fa')
  twoFactorStatus() {
    return this.auth.twoFactorStatus();
  }

  // 2FA amallari parol/kod taxmin qilishga yo'l ochmasligi uchun qattiq limit bilan
  @Authenticated()
  @Throttle({ default: { limit: 10, ttl: 15 * 60_000 } })
  @Post('2fa/setup')
  @HttpCode(200)
  twoFactorSetup(@Body() dto: PasswordDto) {
    return this.auth.twoFactorSetup(dto.password);
  }

  @Authenticated()
  @Throttle({ default: { limit: 10, ttl: 15 * 60_000 } })
  @Post('2fa/enable')
  @HttpCode(200)
  twoFactorEnable(@Body() dto: TotpCodeDto) {
    return this.auth.twoFactorEnable(dto.code);
  }

  @Authenticated()
  @Throttle({ default: { limit: 10, ttl: 15 * 60_000 } })
  @Post('2fa/disable')
  @HttpCode(200)
  twoFactorDisable(@Body() dto: TotpDisableDto) {
    return this.auth.twoFactorDisable(dto.password, dto.code);
  }

  @Portal()
  @Get('me')
  async me(@CurrentUser() user: AuthContext) {
    const tenant = await this.db.tenant.findUnique({ where: { id: user.tenantId }, select: { name: true } });
    const self = await this.db.tx((tx) => tx.user.findUnique({ where: { id: user.userId }, select: { photoFileId: true } }));
    return {
      id: user.userId,
      tenant_id: user.tenantId,
      tenant_name: tenant?.name ?? '',
      full_name: user.fullName,
      photo_url: this.files.url(user.tenantId, self?.photoFileId),
      roles: user.roles,
      role_names: user.roleNames,
      permissions: user.permissions,
      allowed_branch_ids: user.allowedBranchIds,
    };
  }
}
