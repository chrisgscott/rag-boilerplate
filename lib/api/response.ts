import { NextResponse } from "next/server";

export function apiSuccess(data: unknown, status = 200): Response {
  return NextResponse.json({ data }, { status });
}

export function apiError(
  code: string,
  message: string,
  status: number
): Response {
  return NextResponse.json({ error: { code, message } }, { status });
}
