import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { RequestContextStore } from './request-context';

// Har bir javobda X-Request-Id (TZ 9.1); kontekst guard va servislar uchun ALS'da saqlanadi
export function requestContextMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.headers['x-request-id'];
  const requestId = typeof incoming === 'string' && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
  res.setHeader('X-Request-Id', requestId);
  RequestContextStore.run({ requestId, ip: req.ip, userAgent: req.headers['user-agent'] }, next);
}
