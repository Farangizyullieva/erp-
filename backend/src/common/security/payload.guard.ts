import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { AppError } from '../http/app-error';

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_DEPTH = 12;
const MAX_NODES = 5000;

/**
 * Prototype pollution va "og'ir" payload'larga qarshi: body va query ichida `__proto__` / `constructor` /
 * `prototype` kalitlari bo'lsa yoki tuzilma haddan tashqari chuqur/katta bo'lsa so'rov rad etiladi.
 * DTO whitelist'i bularni baribir olib tashlaydi — bu guard ular validatsiyagacha ham yetib bormasligini kafolatlaydi.
 */
@Injectable()
export class PayloadGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    let nodes = 0;
    const scan = (value: unknown, depth: number): void => {
      if (value === null || typeof value !== 'object') return;
      if (depth > MAX_DEPTH || ++nodes > MAX_NODES) throw new AppError('PAYLOAD_TOO_COMPLEX', 400, "So'rov tuzilmasi juda murakkab");
      for (const key of Object.keys(value)) {
        if (FORBIDDEN_KEYS.has(key)) throw new AppError('FORBIDDEN_KEY', 400, "So'rovda ruxsat etilmagan kalit bor");
        scan((value as Record<string, unknown>)[key], depth + 1);
      }
    };
    scan(req.body, 0);
    scan(req.query, 0);
    return true;
  }
}
