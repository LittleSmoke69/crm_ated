import { NextResponse } from 'next/server';

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  pagination?: any;
  meta?: any;
}

export function successResponse<T>(
  data: T,
  messageOrOptions?: string | { message?: string; pagination?: any; meta?: any },
  status: number = 200
): NextResponse {
  let message: string | undefined;
  let pagination: any | undefined;
  let meta: any | undefined;

  if (typeof messageOrOptions === 'string') {
    message = messageOrOptions;
  } else if (typeof messageOrOptions === 'object') {
    message = messageOrOptions.message;
    pagination = messageOrOptions.pagination;
    meta = messageOrOptions.meta;
  }

  return NextResponse.json(
    {
      success: true,
      data,
      message,
      pagination,
      meta,
    } as ApiResponse<T>,
    { status }
  );
}

export function errorResponse(error: string | Error, status: number = 400): NextResponse {
  const errorMessage = error instanceof Error ? error.message : error;
  return NextResponse.json(
    {
      success: false,
      error: errorMessage,
    } as ApiResponse,
    { status }
  );
}

export function serverErrorResponse(error: string | Error | any): NextResponse {
  const err = typeof error === 'object' && error !== null && 'statusCode' in error
    ? (error as any)
    : null;
  const status = err?.statusCode === 503 ? 503 : 500;

  let message: string;
  if (error instanceof Error) {
    message = error.message;
  } else if (typeof error === 'object' && error !== null) {
    // Tenta pegar message, hint ou details de erros do Supabase/PG
    message = error.message || error.details || error.hint || JSON.stringify(error);
  } else {
    message = String(error);
  }

  return errorResponse(message, status);
}

