import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { map, Observable } from 'rxjs';

/** Servis `Page` qaytarsa meta bilan, aks holda `{ data }` ichiga o'raladi */
export class Page<T> {
  constructor(
    readonly data: T[],
    readonly meta: { next_cursor: string | null; total?: number },
  ) {}
}

@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  intercept(_ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      map((value: unknown) => {
        if (value instanceof Page) return { data: value.data, meta: value.meta };
        return { data: value ?? null };
      }),
    );
  }
}
