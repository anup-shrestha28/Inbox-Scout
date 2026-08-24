import { NextResponse } from "next/server";

export function apiError(error: unknown, fallback = "Something went wrong.") {
  const message = error instanceof Error ? error.message : fallback;
  if (message === "UNAUTHORIZED") {
    return NextResponse.json({ error: "Please sign in to continue." }, { status: 401 });
  }
  return NextResponse.json({ error: message || fallback }, { status: 400 });
}

