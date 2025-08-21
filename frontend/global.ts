import { create } from "zustand";
import { combine } from "zustand/middleware";
import { type CurrentUser, currentUserSchema } from "@/models/user";
import { assertDefined } from "@/utils/assert";

export const useUserStore = create(
  combine(
    {
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- temporary
      user: null as CurrentUser | null,
      pending: false,
    },
    (set) => ({
      login: (user: unknown) => set({ user: currentUserSchema.parse(user) }),
      logout: () => set({ user: null }),
      setRedirected: () =>
        set((state) => {
          if (!state.user) return state;
          return { user: { ...state.user, onboardingPath: null } };
        }),
    }),
  ),
);

export const useCurrentUser = () => {
  const { user } = useUserStore((state) => state);

  if (!user) {
    throw new Error("User not authenticated");
  }

  return user;
};
export const useCurrentCompany = () => {
  const user = useCurrentUser();
  return assertDefined(user.companies.find((c) => c.id === user.currentCompanyId));
};

export const useCurrentUserSafe = () => {
  const { user } = useUserStore((state) => state);
  return user;
};
