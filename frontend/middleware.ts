import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import env from "@/env";
import { hasRequiredRole, isAuthRoute, isExcludedRoute, isProtectedRoute, SAFE_ROUTES } from "@/lib/routes";

export default async function middleware(req: NextRequest): Promise<NextResponse> {
  const { pathname } = req.nextUrl;

  // Skip middleware for excluded routes
  if (isExcludedRoute(pathname)) {
    return NextResponse.next();
  }

  const token = await getToken({ req, secret: env.NEXTAUTH_SECRET });
  const isAuthenticated = !!token;
  const userRoles = token?.roles;

  let response: NextResponse;

  if (isAuthenticated && isAuthRoute(pathname)) {
    // Redirect authenticated users away from auth pages
    response = NextResponse.redirect(new URL(SAFE_ROUTES.DASHBOARD, req.url));
  } else if (isProtectedRoute(pathname)) {
    if (!isAuthenticated) {
      // Redirect unauthenticated users to login
      const loginUrl = new URL(SAFE_ROUTES.LOGIN, req.url);
      loginUrl.searchParams.set("redirect_url", pathname + req.nextUrl.search);
      response = NextResponse.redirect(loginUrl);
    } else if (!hasRequiredRole(pathname, userRoles as Record<string, unknown> | undefined)) {
      // Redirect users without required role to dashboard
      response = NextResponse.redirect(new URL(SAFE_ROUTES.DASHBOARD, req.url));
    } else {
      response = NextResponse.next();
    }
  } else {
    response = NextResponse.next();
  }

  // Apply CSP headers
  const { NODE_ENV } = process.env;
  const s3Urls = [env.S3_PRIVATE_BUCKET, env.S3_PUBLIC_BUCKET]
    .map((bucket) => `https://${bucket}.s3.${env.AWS_REGION}.amazonaws.com https://${bucket}.s3.amazonaws.com`)
    .join(" ");
  const helperUrls = ["https://help.flexile.com", "wss://xmrztjqxvugqpgvxpmzz.supabase.co/realtime/v1/websocket"].join(
    " ",
  );

  const cspHeader = `
    default-src 'self';
    script-src 'self' 'unsafe-inline' https://js.stripe.com ${NODE_ENV === "production" ? "" : `'unsafe-eval'`};
    style-src 'self' 'unsafe-inline';
    connect-src 'self' ${helperUrls} ${s3Urls};
    img-src 'self' blob: data: ${s3Urls};
    worker-src 'self' blob:;
    font-src 'self';
    base-uri 'self';
    frame-ancestors ${NODE_ENV === "production" ? "'none'" : "'self'"};
    frame-src 'self' https://challenges.cloudflare.com https://js.stripe.com https://www.youtube.com;
    form-action 'self';
    upgrade-insecure-requests;
  `
    .replace(/\s{2,}/gu, " ")
    .trim();

  response.headers.set("Content-Security-Policy", cspHeader);

  if (!response.headers.get("location")) {
    const requestHeaders = new Headers(req.headers);
    requestHeaders.set("Content-Security-Policy", cspHeader);
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
  ],
};
