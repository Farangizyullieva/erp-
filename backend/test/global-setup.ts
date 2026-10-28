import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import './env';

// Test bazasiga migration'lar har safar qo'llanadi (idempotent)
export default function globalSetup(): void {
  execSync('npx prisma migrate deploy', { cwd: resolve(__dirname, '..'), env: process.env, stdio: 'pipe' });
}
