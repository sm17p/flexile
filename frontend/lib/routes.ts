import type { Route } from "next";

// Define role types based on the user schema
export type UserRole = "administrator" | "lawyer" | "investor" | "worker";

// Define the structure of user roles from the schema
export interface UserRoles {
  administrator?: { id: string; isInvited: boolean };
  lawyer?: { id: string };
  investor?: {
    id: string;
    hasDocuments: boolean;
    investedInAngelListRuv: boolean;
    hasGrants: boolean;
    hasShares: boolean;
    hasConvertibles: boolean;
  };
  worker?: {
    id: string;
    hasDocuments: boolean;
    endedAt: string | null;
    payRateType: "hourly" | "project_based";
    role: string | null;
    payRateInSubunits: number | null;
    equityPercentage: number;
  };
}

/**
 * Minimal route configuration - single source of truth
 */
export const routeConfig = {
  public: ["/", "/login", "/signup", "/invite", "/privacy", "/terms", "/oauth_redirect"],

  authOnly: ["/login", "/signup"],

  protected: {
    "/people": ["administrator"],
    "/invoices": ["administrator", "worker"],
    "/equity": ["administrator", "investor", "lawyer"],
    "/settings": ["administrator", "lawyer", "investor", "worker"],
    "/documents": ["administrator", "lawyer", "investor", "worker"],
    "/updates": ["administrator", "lawyer", "investor", "worker"],
    "/roles": ["administrator"],
    "/expenses": ["administrator", "worker"],
    "/support": ["administrator", "lawyer", "investor", "worker"],
    "/companies": ["administrator", "lawyer", "investor", "worker"],
    "/download": ["administrator", "lawyer", "investor", "worker"],
    "/onboarding": ["administrator", "lawyer", "investor", "worker"],
  },

  // Excluded from middleware processing
  excluded: ["/trpc", "/_next", "/favicon.ico", "/robots.txt", "/sitemap.xml", "/manifest.json"],

  // Rails proxy path prefixes - requests to these should be proxied to Rails
  railsProxy: ["/internal", "/admin", "/webhooks", "/api", "/v1", "/rails", "/assets"],
} as const;

export const isPublicRoute = (pathname: string): boolean =>
  routeConfig.public.some((route) => pathname === route || pathname.startsWith(`${route}/`));

export const isAuthRoute = (pathname: string): boolean =>
  routeConfig.authOnly.some((route) => pathname === route || pathname.startsWith(`${route}/`));

export const isProtectedRoute = (pathname: string): boolean =>
  Object.keys(routeConfig.protected).some((route) => pathname.startsWith(route));

export const hasRequiredRole = (pathname: string, userRoles?: Record<string, unknown>): boolean => {
  const matchingRoute = Object.entries(routeConfig.protected).find(([route]) => pathname.startsWith(route));

  if (!matchingRoute) return true; // Not a protected route

  const allowedRoles = matchingRoute[1];

  if (!userRoles) return false;

  return allowedRoles.some((role) => !!userRoles[role]);
};

export const isExcludedRoute = (pathname: string): boolean =>
  routeConfig.excluded.some((pattern) => pathname.startsWith(pattern));

export const isRailsRoute = (pathname: string): boolean =>
  routeConfig.railsProxy.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));

export const SAFE_ROUTES = {
  LOGIN: "/login",
  DASHBOARD: "/invoices",
  HOME: "/",
} as const;

export type RouteKind = "excluded" | "public" | "auth" | "protected" | "unknown";

export const classifyRoute = (pathname: string): { kind: RouteKind; roles?: readonly UserRole[] } => {
  if (isExcludedRoute(pathname)) return { kind: "excluded" };
  if (isAuthRoute(pathname)) return { kind: "auth" };
  if (isPublicRoute(pathname)) return { kind: "public" };
  const protectedEntry = Object.entries(routeConfig.protected).find(([route]) => pathname.startsWith(route));
  if (protectedEntry) return { kind: "protected", roles: protectedEntry[1] };
  return { kind: "unknown" };
};

export const isKnownRoute = (pathname: string): boolean => classifyRoute(pathname).kind !== "unknown";

export const getPrimaryRole = (userRoles?: Record<string, unknown>): UserRole | null => {
  if (!userRoles) return null;

  // Priority order: administrator > lawyer > investor > worker
  if (userRoles.administrator) return "administrator";
  if (userRoles.lawyer) return "lawyer";
  if (userRoles.investor) return "investor";
  if (userRoles.worker) return "worker";

  return null;
};

export type { Route };
