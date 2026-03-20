import { NextResponse } from 'next/server';

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  /** Código semântico para o cliente tratar (ex.: instância Evolution indisponível). */
  code?: string;
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

export function errorResponse(
  error: string | Error,
  status: number = 400,
  extra?: Record<string, unknown>
): NextResponse {
  const errorMessage = error instanceof Error ? error.message : error;
  return NextResponse.json(
    {
      success: false,
      error: errorMessage,
      ...(extra && typeof extra === 'object' ? extra : {}),
    } as ApiResponse,
    { status }
  );
}

/** Mensagens que indicam erro de autenticação (retornar 401) */
const AUTH_ERROR_MESSAGES = ['Não autenticado', 'Usuário inválido', 'Perfil não encontrado'];

/** Mensagens que indicam erro de autorização (retornar 403) */
const FORBIDDEN_MESSAGES = ['Acesso negado'];

export function serverErrorResponse(error: string | Error | any): NextResponse {
  const err = typeof error === 'object' && error !== null && 'statusCode' in error
    ? (error as any)
    : null;
  let status = err?.statusCode === 503 ? 503 : 500;

  let message: string;
  if (error instanceof Error) {
    message = error.message;
  } else if (typeof error === 'object' && error !== null) {
    message = error.message || error.details || error.hint || JSON.stringify(error);
  } else {
    message = String(error);
  }

  if (status === 500 && AUTH_ERROR_MESSAGES.some((msg) => message.includes(msg))) {
    status = 401;
  } else if (status === 500 && FORBIDDEN_MESSAGES.some((msg) => message.includes(msg))) {
    status = 403;
  }

  return errorResponse(message, status);
}

