import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { companyProcedure, createRouter } from "@/trpc";
import { company_administrator_settings_workspace_roles_url } from "@/utils/routes";
import { usersWithoutRoleSchema, type UserWithoutRoleInfo, userWithoutRoleSchema } from "./serde";

export const workspaceRolesRouter = createRouter({
  usersWithoutRole: companyProcedure
    .input(usersWithoutRoleSchema)
    .query(async ({ ctx, input }): Promise<UserWithoutRoleInfo[]> => {
      if (!ctx.companyAdministrator) throw new TRPCError({ code: "FORBIDDEN" });

      const params = new URLSearchParams();
      params.append("available_only", "true");

      if (input.excludeRoledUserIds?.length) {
        input.excludeRoledUserIds.forEach((id) => {
          params.append("excludeRoledUserIds[]", id);
        });
      }

      const apiUrl = company_administrator_settings_workspace_roles_url(ctx.company.externalId, {
        host: ctx.host,
        params: Object.fromEntries(params),
      });

      const response = await fetch(apiUrl, {
        method: "GET",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          ...ctx.headers,
        },
      });

      if (!response.ok) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to fetch users without roles" });
      }

      return z.array(userWithoutRoleSchema).parse(await response.json());
    }),
});

export type { UserWithoutRoleInfo };
