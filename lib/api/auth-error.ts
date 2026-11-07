import { NextResponse } from "next/server";

export function authErrorResponse(error: any, fallbackStatus = 500) {
  const message = error?.message || "Internal Server Error";
  const status =
    typeof message === "string" && message.startsWith("Unauthorized")
      ? 401
      : typeof message === "string" && message.includes("Forbidden")
        ? 403
        : fallbackStatus;
  return NextResponse.json({ error: message }, { status });
}
