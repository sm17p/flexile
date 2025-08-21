"use client";

import { signOut } from "next-auth/react";
import { useCallback } from "react";
import { useUserStore } from "@/global";
import { SAFE_ROUTES } from "./routes";

/**
 * Clean signout hook that handles both NextAuth and app state
 */
export const useSignOut = () => {
  const { logout } = useUserStore();

  return useCallback(
    async (options?: { callbackUrl?: string; redirect?: boolean }) => {
      const { callbackUrl = "/login", redirect = true } = options ?? {};

      try {
        logout();

        if (redirect) {
          await signOut({ callbackUrl, redirect: true });
        } else {
          const result = await signOut({ redirect: false });
          if (result.url) {
            window.location.href = result.url;
          } else {
            window.location.href = callbackUrl;
          }
        }
      } catch {
        logout();
        window.location.href = callbackUrl;
      }
    },
    [logout],
  );
};

/**
 * Get the current URL with search params for redirects
 */
export const getCurrentUrl = (): string => {
  if (typeof window === "undefined") return "/";
  return window.location.pathname + window.location.search;
};

/**
 * Create login redirect URL with current page as redirect_url
 */
export const createLoginRedirectUrl = (pathname?: string): string => {
  const currentPath = pathname ?? getCurrentUrl();
  if (typeof window !== "undefined") {
    sessionStorage.setItem("redirectAfterLogin", currentPath);
  }
  return SAFE_ROUTES.LOGIN;
};

/**
 * Check if a redirect URL is safe (starts with / but not //)
 */
export const isSafeRedirectUrl = (url: string): boolean => url.startsWith("/") && !url.startsWith("//");

/**
 * Get a safe redirect URL or fallback to default
 */
export const getSafeRedirectUrl = (redirectUrl: string | null, fallback: string = SAFE_ROUTES.DASHBOARD): string => {
  if (redirectUrl && isSafeRedirectUrl(redirectUrl)) {
    return redirectUrl;
  }
  return fallback;
};

/**
 * Auth state checker that doesn't throw redirects
 */
export const useAuthState = () => {
  const { user } = useUserStore((state) => state);

  return {
    user,
    isAuthenticated: !!user,
    needsLogin: !user,
  };
};

/**
 * Get redirect URL after successful login
 */
export const getPostLoginRedirect = (): string => {
  if (typeof window === "undefined") return SAFE_ROUTES.DASHBOARD;

  const stored = sessionStorage.getItem("redirectAfterLogin");
  sessionStorage.removeItem("redirectAfterLogin");

  return getSafeRedirectUrl(stored, SAFE_ROUTES.DASHBOARD);
};

/**
 * Check if user needs onboarding
 */
export const useOnboardingCheck = () => {
  const { user } = useUserStore();

  return {
    needsOnboarding: !!user?.onboardingPath,
    onboardingPath: user?.onboardingPath,
    isOnboardingComplete: !user?.onboardingPath,
  };
};

// Re-export for convenience
export { SAFE_ROUTES } from "./routes";
