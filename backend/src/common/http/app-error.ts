import { HttpStatus } from '@nestjs/common';

export interface ErrorDetail {
  field: string;
  code: string;
  message: string;
}

export class AppError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
    readonly details?: ErrorDetail[],
  ) {
    super(message);
  }

  static validation(details: ErrorDetail[]): AppError {
    return new AppError('VALIDATION_ERROR', HttpStatus.BAD_REQUEST, "Kiritilgan ma'lumotda xatolik bor", details);
  }
  static field(field: string, code: string, message: string): AppError {
    return AppError.validation([{ field, code, message }]);
  }
  static unauthorized(message = 'Autentifikatsiya talab qilinadi', code = 'UNAUTHORIZED'): AppError {
    return new AppError(code, HttpStatus.UNAUTHORIZED, message);
  }
  static forbidden(message = "Bu amal uchun ruxsat yo'q"): AppError {
    return new AppError('FORBIDDEN', HttpStatus.FORBIDDEN, message);
  }
  static notFound(what = 'Obyekt'): AppError {
    return new AppError('NOT_FOUND', HttpStatus.NOT_FOUND, `${what} topilmadi`);
  }
  static conflict(message: string, code = 'CONFLICT'): AppError {
    return new AppError(code, HttpStatus.CONFLICT, message);
  }
}
