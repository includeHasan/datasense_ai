import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const TOKEN_COOKIE = "ds_token";
const PUBLIC_PATHS = new Set(["/login", "/register"]);
// "/" renders a marketing landing page for signed-out visitors and the app
// itself for signed-in users — the client decides which, so it must always
// be reachable rather than force-redirected to /login.
const ALWAYS_PUBLIC_PATHS = new Set(["/demo", "/"]);

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
