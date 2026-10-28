import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { hash, verify } from '@node-rs/argon2';
import { AccessTokenPayload } from '../../common/auth/access.guard';
import { AlertService } from '../../common/alerts/alert.service';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService, Tx } from '../../common/db/prisma.service';
import { AppError } from '../../common/http/app-error';
import { RequestContextStore } from '../../common/context/request-context';
import { generateTotpSecret, otpauthUrl, SecretBox, verifyTotp } from '../../common/security/totp';
import { normalizePhone } from '../../common/utils/phone';
import { LoginDto } from './dto/auth.dto';

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

// Argon2id — @node-rs/argon2 default algoritmi (TZ 11.3)
export const hashPassword = (password: string): Promise<string> => hash(password);

// Foydalanuvchi topilmaganda ham parol tekshiruvi vaqti sarflanadi — javob vaqtidan akkaunt bor-yo'qligini bilib bo'lmaydi
const DUMMY_HASH = hash('timing-equalizer-password');

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');
const invalidCredentials = (): AppError =>
  AppError.unauthorized("Login yoki parol noto'g'ri", 'INVALID_CREDENTIALS');
const invalidRefresh = (): AppError => AppError.unauthorized('Refresh token yaroqsiz', 'REFRESH_INVALID');

@Injectable()
export class AuthService {
  private readonly accessTtl: number;
  private readonly refreshTtlMs: number;
  private readonly secrets: SecretBox;

  constructor(
    private readonly db: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
    private readonly alerts: AlertService,
  ) {
    this.accessTtl = Number(config.get('JWT_ACCESS_TTL_SECONDS') ?? 900);
    this.refreshTtlMs = Number(config.get('REFRESH_TTL_DAYS') ?? 30) * 86_400_000;
    this.secrets = new SecretBox(config.get<string>('SECRETS_ENC_KEY'));
  }

  async login(dto: LoginDto): Promise<TokenPair> {
    const slug = dto.tenant ?? this.config.get<string>('DEFAULT_TENANT_SLUG');
    const tenant = slug ? await this.db.tenant.findFirst({ where: { slug, isActive: true } }) : null;
    if (!tenant) throw invalidCredentials();

    const login = dto.login.trim();
    const where = login.includes('@') ? { email: login.toLowerCase() } : { phone: normalizePhone(login) ?? '' };

    // Muvaffaqiyatsiz urinish hisoblagichi rollback bo'lmasligi uchun natija transaction'dan tashqarida tashlanadi
    const result = await this.db.tx(async (tx) => {
      const user = await tx.user.findFirst({ where });
      if (!user || !user.isActive) {
        await verify(await DUMMY_HASH, dto.password);
        return { ok: false as const, error: invalidCredentials() };
      }
      if (user.lockedUntil && user.lockedUntil > new Date()) {
        return {
          ok: false as const,
          error: new AppError(
            'ACCOUNT_LOCKED',
            429,
            `Parol ${MAX_FAILED_ATTEMPTS} marta noto'g'ri kiritildi. Akkaunt ${LOCK_MINUTES} daqiqaga bloklandi`,
          ),
        };
      }
      if (!(await verify(user.passwordHash, dto.password))) {
        await this.registerFailure(tx, tenant.id, user);
        return { ok: false as const, error: invalidCredentials() };
      }
      // Ikkinchi bosqich (MFA): o'g'irlangan parolning o'zi kirish uchun yetarli emas
      let totpLastStep: number | undefined;
      if (user.totpEnabledAt && user.totpSecret) {
        if (!dto.totp_code) {
          return { ok: false as const, error: AppError.unauthorized('Autentifikator ilovasidagi 6 xonali kodni kiriting', 'TOTP_REQUIRED') };
        }
        const step = verifyTotp(this.secrets.decrypt(user.totpSecret), dto.totp_code, user.totpLastStep);
        if (step === null) {
          // Noto'g'ri kod ham xato urinish hisoblanadi — 6 xonali kodni saralab topib bo'lmaydi
          await this.registerFailure(tx, tenant.id, user);
          return { ok: false as const, error: AppError.unauthorized("Tasdiqlash kodi noto'g'ri yoki eskirgan", 'TOTP_INVALID') };
        }
        totpLastStep = step;
      }
      await tx.user.update({
        where: { id: user.id },
        data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date(), totpLastStep },
      });
      return { ok: true as const, tokens: await this.issue(tx, tenant.id, user.id, randomUUID()) };
    }, tenant.id);

    if (!result.ok) throw result.error;
    return result.tokens;
  }

  private async registerFailure(tx: Tx, tenantId: string, user: { id: string; failedLoginCount: number }): Promise<void> {
    const failed = user.failedLoginCount + 1;
    const locked = failed >= MAX_FAILED_ATTEMPTS;
    await tx.user.update({
      where: { id: user.id },
      data: { failedLoginCount: locked ? 0 : failed, lockedUntil: locked ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null },
    });
    if (locked) {
      await this.audit.write(tx, tenantId, { action: 'auth.locked', entityType: 'user', entityId: user.id, actorId: user.id });
      this.alerts.send('warning', 'Akkaunt bloklandi', [`${MAX_FAILED_ATTEMPTS} marta noto'g'ri parol yoki kod — ${LOCK_MINUTES} daqiqaga bloklandi`, `Foydalanuvchi ID: ${user.id}`], `locked:${user.id}`);
    }
  }

  twoFactorStatus() {
    const auth = RequestContextStore.auth();
    return this.db.tx(async (tx) => {
      const user = await tx.user.findUniqueOrThrow({ where: { id: auth.userId }, select: { totpEnabledAt: true } });
      // TZ 11.3: owner va accountant uchun 2FA majburiy (hozircha tavsiya sifatida ko'rsatiladi)
      return { enabled: user.totpEnabledAt !== null, recommended: auth.roles.some((r) => r === 'owner' || r === 'accountant') };
    });
  }

  /** Yangi kalit yaratadi; kod bilan tasdiqlanmaguncha 2FA yoqilmaydi */
  twoFactorSetup(password: string) {
    const auth = RequestContextStore.auth();
    return this.db.tx(async (tx) => {
      const user = await this.confirmPassword(tx, auth.userId, password);
      if (user.totpEnabledAt) throw AppError.conflict('Ikki bosqichli tasdiqlash allaqachon yoqilgan', 'TOTP_ALREADY_ENABLED');
      const secret = generateTotpSecret();
      await tx.user.update({ where: { id: user.id }, data: { totpSecret: this.secrets.encrypt(secret), totpLastStep: null } });
      return { secret, otpauth_url: otpauthUrl(secret, user.phone ?? user.email ?? user.fullName) };
    });
  }

  twoFactorEnable(code: string) {
    const auth = RequestContextStore.auth();
    return this.db.tx(async (tx) => {
      const user = await tx.user.findUniqueOrThrow({ where: { id: auth.userId } });
      if (user.totpEnabledAt) throw AppError.conflict('Ikki bosqichli tasdiqlash allaqachon yoqilgan', 'TOTP_ALREADY_ENABLED');
      if (!user.totpSecret) throw AppError.conflict('Avval sozlashni boshlang', 'TOTP_NOT_SET_UP');
      const step = verifyTotp(this.secrets.decrypt(user.totpSecret), code, null);
      if (step === null) throw AppError.field('code', 'TOTP_INVALID', "Kod noto'g'ri yoki eskirgan");
      await tx.user.update({ where: { id: user.id }, data: { totpEnabledAt: new Date(), totpLastStep: step } });
      await this.audit.write(tx, auth.tenantId, { action: 'auth.2fa_enabled', entityType: 'user', entityId: user.id });
      return { enabled: true };
    });
  }

  /** O'chirish uchun ham parol, ham joriy kod kerak — ochiq qolgan sessiya orqali 2FA'ni olib tashlab bo'lmaydi */
  twoFactorDisable(password: string, code: string) {
    const auth = RequestContextStore.auth();
    return this.db.tx(async (tx) => {
      const user = await this.confirmPassword(tx, auth.userId, password);
      if (!user.totpEnabledAt || !user.totpSecret) throw AppError.conflict('Ikki bosqichli tasdiqlash yoqilmagan', 'TOTP_NOT_ENABLED');
      if (verifyTotp(this.secrets.decrypt(user.totpSecret), code, user.totpLastStep) === null) {
        throw AppError.field('code', 'TOTP_INVALID', "Kod noto'g'ri yoki eskirgan");
      }
      await tx.user.update({ where: { id: user.id }, data: { totpSecret: null, totpEnabledAt: null, totpLastStep: null } });
      await this.audit.write(tx, auth.tenantId, { action: 'auth.2fa_disabled', entityType: 'user', entityId: user.id });
      this.alerts.send('warning', "Ikki bosqichli tasdiqlash o'chirildi", [`Foydalanuvchi: ${user.fullName}`], `2fa-off:${user.id}`);
      return { enabled: false };
    });
  }

  private async confirmPassword(tx: Tx, userId: string, password: string) {
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await verify(user.passwordHash, password))) throw AppError.field('password', 'INVALID_PASSWORD', "Parol noto'g'ri");
    return user;
  }

  /** Rotation + reuse detection: ishlatilgan token qayta kelsa butun oila bekor qilinadi (TZ 11.3) */
  async refresh(raw: string): Promise<TokenPair> {
    const tenantId = this.tenantOf(raw);
    const result = await this.db.tx(async (tx) => {
      const token = await tx.refreshToken.findUnique({ where: { tokenHash: sha256(raw) } });
      if (!token) return null;
      if (token.revokedAt) {
        await tx.refreshToken.updateMany({
          where: { familyId: token.familyId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        await this.audit.write(tx, tenantId, {
          action: 'auth.refresh_reuse_detected',
          entityType: 'user',
          entityId: token.userId,
          actorId: token.userId,
        });
        this.alerts.send('critical', "Sessiya o'g'irlanishi ehtimoli", ['Ishlatilgan refresh token qayta yuborildi — foydalanuvchining barcha sessiyalari yopildi', `Foydalanuvchi ID: ${token.userId}`], `reuse:${token.userId}`);
        return null;
      }
      if (token.expiresAt <= new Date()) return null;
      const user = await tx.user.findFirst({ where: { id: token.userId, isActive: true }, select: { id: true } });
      if (!user) return null;

      const tokens = await this.issue(tx, tenantId, user.id, token.familyId);
      const next = await tx.refreshToken.findUniqueOrThrow({
        where: { tokenHash: sha256(tokens.refresh_token) },
        select: { id: true },
      });
      await tx.refreshToken.update({
        where: { id: token.id },
        data: { revokedAt: new Date(), replacedById: next.id },
      });
      return tokens;
    }, tenantId);

    if (!result) throw invalidRefresh();
    return result;
  }

  async logout(raw: string): Promise<void> {
    const tenantId = this.tenantOf(raw);
    await this.db.tx(async (tx) => {
      const token = await tx.refreshToken.findUnique({ where: { tokenHash: sha256(raw) } });
      if (!token) return;
      await tx.refreshToken.updateMany({
        where: { familyId: token.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }, tenantId);
  }

  private async issue(tx: Tx, tenantId: string, userId: string, familyId: string): Promise<TokenPair> {
    // Token tenant prefiksi bilan: refresh'da RLS uchun tenant token'ning o'zidan aniqlanadi; DB'da faqat hash
    const refreshToken = `${tenantId}.${randomBytes(32).toString('base64url')}`;
    await tx.refreshToken.create({
      data: {
        tenantId,
        userId,
        familyId,
        tokenHash: sha256(refreshToken),
        expiresAt: new Date(Date.now() + this.refreshTtlMs),
      },
    });
    const payload: AccessTokenPayload = { sub: userId, tid: tenantId };
    return {
      access_token: await this.jwt.signAsync(payload, { expiresIn: this.accessTtl }),
      refresh_token: refreshToken,
      expires_in: this.accessTtl,
    };
  }

  private tenantOf(raw: string): string {
    const tenantId = raw.split('.')[0] ?? '';
    if (!UUID_RE.test(tenantId)) throw invalidRefresh();
    return tenantId;
  }
}
