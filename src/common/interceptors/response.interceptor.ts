import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface ApiResponse<T> {
  success: boolean;
  message: string;
  data?: T;
  meta?: Record<string, unknown>;
}

@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, ApiResponse<T>> {
  intercept(context: ExecutionContext, next: CallHandler): Observable<ApiResponse<T>> {
    return next.handle().pipe(
      map((res) => {
        // If response is already formatted
        if (res && typeof res === 'object') {
          if ('success' in res && 'message' in res) {
            return res;
          }
          if ('message' in res && ('data' in res || 'meta' in res)) {
            return {
              success: true,
              message: res.message || 'Operation successful',
              data: res.data !== undefined ? res.data : undefined,
              ...(res.unreadCount !== undefined ? { unreadCount: res.unreadCount } : {}),
              meta: res.meta !== undefined ? res.meta : undefined,
            };
          }
          if ('data' in res && 'meta' in res) {
            return {
              success: true,
              message: 'Success',
              data: res.data,
              meta: res.meta,
            };
          }
        }

        return {
          success: true,
          message: 'Success',
          data: res ?? null,
        };
      }),
    );
  }
}
