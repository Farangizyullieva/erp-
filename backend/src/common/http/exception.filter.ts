import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import type { AlertService } from '../alerts/alert.service';
import { RequestContextStore } from '../context/request-context';
import { AppError, ErrorDetail } from './app-error';

interface ErrorBody {
  code: string;
  message: string;
  details?: ErrorDetail[];
}

const HTTP_CODES: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  429: 'RATE_LIMITED',
};

// Yagona xato formati (TZ 9.1): { error: { code, message, details, request_id } }
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Http');

  constructor(private readonly alerts?: AlertService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const requestId = RequestContextStore.get()?.requestId;
    const { status, body } = this.map(exception);
    if (status >= 500) {
      this.logger.error({ requestId, err: exception instanceof Error ? exception.stack : exception });
      const req = host.switchToHttp().getRequest<Request>();
      const error = exception instanceof Error ? exception : new Error(String(exception));
      // Faqat yo'l (query'siz), xato turi va joyi — so'rov tanasi va sarlavhalar yuborilmaydi
      const where = error.stack?.split('\n').find((line) => line.includes('/src/') || line.includes('/dist/'))?.trim().replace(/^at /, '');
      this.alerts?.send(
        'error',
        `Server xatosi (${status})`,
        [`${req.method} ${req.path}`, `${error.name}: ${error.message.replace(/\s+/g, ' ').slice(0, 400)}`, where && `📍 ${where.slice(0, 200)}`, requestId && `request_id: ${requestId}`],
        `5xx:${req.method}:${req.route?.path ?? req.path}:${error.name}`,
      );
    }
    res.status(status).json({ error: { ...body, request_id: requestId } });
  }

  private map(e: unknown): { status: number; body: ErrorBody } {
    if (e instanceof AppError) {
      return { status: e.status, body: { code: e.code, message: e.message, details: e.details } };
    }
    if (e instanceof HttpException) {
      const status = e.getStatus();
      const message = status === 429 ? "So'rovlar soni limitdan oshdi, keyinroq urinib ko'ring" : e.message;
      return { status, body: { code: HTTP_CODES[status] ?? 'ERROR', message } };
    }
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      if (e.code === 'P2002') {
        return { status: HttpStatus.CONFLICT, body: { code: 'CONFLICT', message: 'Bunday yozuv allaqachon mavjud' } };
      }
      if (e.code === 'P2003') {
        return {
          status: HttpStatus.BAD_REQUEST,
          body: { code: 'VALIDATION_ERROR', message: "Bog'langan obyekt topilmadi" },
        };
      }
      if (e.code === 'P2025') {
        return { status: HttpStatus.NOT_FOUND, body: { code: 'NOT_FOUND', message: 'Obyekt topilmadi' } };
      }
    }
    // body-parser xatolari (http-errors): juda katta yoki buzilgan JSON
    const status = typeof e === 'object' && e !== null && 'status' in e ? Number((e as { status: unknown }).status) : NaN;
    if (status === 413) return { status, body: { code: 'PAYLOAD_TOO_LARGE', message: "So'rov hajmi juda katta" } };
    if (status === 400) return { status, body: { code: 'BAD_REQUEST', message: "So'rov formati noto'g'ri" } };
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: { code: 'INTERNAL_ERROR', message: 'Ichki xatolik yuz berdi' },
    };
  }
}
