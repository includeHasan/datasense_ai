import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const TOKEN_COOKIE = "ds_token";
const PUBLIC_PATHS = new Set(["/login", "/register"]);
const ALWAYS_PUBLIC_PATHS = new Set(["/demo"]);

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasToken = request.cookies.has(TOKEN_COOKIE);
  const isPublicPath = PUBLIC_PATHS.has(pathname);

  if (ALWAYS_PUBLIC_PATHS.has(pathname)) {
    return NextResponse.next();
  }

  if (isPublicPath) {
    if (hasToken) {
      return NextResponse.redirect(new URL("/", request.url));
    }
    return NextResponse.next();
  }

  if (!hasToken) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
