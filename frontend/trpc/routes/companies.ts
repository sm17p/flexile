import { TRPCError } from "@trpc/server";
import { and, eq, inArray } from "drizzle-orm";
import { createUpdateSchema } from "drizzle-zod";
import { pick } from "lodash-es";
import { z } from "zod";
import { db } from "@/db";
import type { WorkspaceMemberRoles } from "@/db/enums";
import { workspaceMemberRoles } from "@/db/enums";
import {
  activeStorageAttachments,
  activeStorageBlobs,
  companies,
  companyAdministrators,
  companyContractors,
  companyInvestors,
  companyLawyers,
  users,
} from "@/db/schema";
import { companyProcedure, createRouter } from "@/trpc";
import {
  company_administrator_settings_workspace_members_url,
  company_administrator_stripe_microdeposit_verifications_url,
  microdeposit_verification_details_company_invoices_url,
} from "@/utils/routes";

type UserWithRoleInfo = {
  id: string;
  email: string;
  name: string;
  isAdmin: boolean;
  isLawyer: boolean;
  isMember: boolean;
  role: WorkspaceMemberRoles;
  isOwner: boolean;
};

export const invitedWorkspaceMemberSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
  role: z.enum(workspaceMemberRoles, {
    errorMap: (issue, ctx) => {
      if (issue.code === z.ZodIssueCode.invalid_enum_value) {
        return { message: "Please select a valid role" };
      }
      return { message: ctx.defaultError };
    },
  }),
});

export const workspaceMemberSchema = z.object({
  userId: z.string(),
  companyId: z.string(),
  role: z.enum(workspaceMemberRoles, {
    errorMap: (issue, ctx) => {
      if (issue.code === z.ZodIssueCode.invalid_enum_value) {
        return { message: "Please select a valid role" };
      }
      return { message: ctx.defaultError };
    },
  }),
});

export const workspaceRoledInvitationsSchema = z.object({
  members: z.array(invitedWorkspaceMemberSchema),
});

export const revokeWorkspaceMemberRoleSchema = z.object({
  userId: z.string(),
});

type WorkspaceMemberData = z.infer<typeof workspaceMemberSchema>;
type WorkspaceInvitationInput = z.infer<typeof workspaceRoledInvitationsSchema>;

export type InviteWorkspaceMembersBody = WorkspaceInvitationInput;
export type UpdateWorkspaceMemberRoleBody = Pick<WorkspaceMemberData, "role">;
export type RevokeWorkspaceMemberRoleBody = null;

export type WorkspaceMemberActionBody =
  | InviteWorkspaceMembersBody
  | UpdateWorkspaceMemberRoleBody
  | RevokeWorkspaceMemberRoleBody;

export const companyName = (company: Pick<typeof companies.$inferSelect, "publicName" | "name">) =>
  company.publicName ?? company.name;

export const companyLogoUrl = async (id: bigint) => {
  const logo = await db.query.activeStorageAttachments.findFirst({
    where: companyLogo(id),
    with: { blob: true },
  });
  return logo?.blob ? `https://${process.env.S3_PUBLIC_BUCKET}.s3.amazonaws.com/${logo.blob.key}` : null;
};

const companyLogo = (id: bigint) =>
  and(
    eq(activeStorageAttachments.recordType, "Company"),
    eq(activeStorageAttachments.recordId, id),
    eq(activeStorageAttachments.name, "logo"),
  );

const decimalRegex = /^\d+(\.\d+)?$/u;

export const companiesRouter = createRouter({
  settings: companyProcedure.query(({ ctx }) => {
    if (!ctx.companyAdministrator) throw new TRPCError({ code: "FORBIDDEN" });

    return pick(ctx.company, ["taxId", "brandColor", "website", "name", "phoneNumber"]);
  }),

  update: companyProcedure
    .input(
      createUpdateSchema(companies, {
        brandColor: (z) => z.regex(/^#([0-9A-F]{6})$/iu, "Invalid hex color"),
        conversionSharePriceUsd: (z) => z.regex(decimalRegex),
        sharePriceInUsd: (z) => z.regex(decimalRegex),
        fmvPerShareInUsd: (z) => z.regex(decimalRegex),
      })
        .pick({
          name: true,
          taxId: true,
          phoneNumber: true,
          streetAddress: true,
          city: true,
          state: true,
          zipCode: true,
          publicName: true,
          website: true,
          brandColor: true,
          sharePriceInUsd: true,
          fmvPerShareInUsd: true,
          conversionSharePriceUsd: true,
        })
        .extend({ logoKey: z.string().optional(), equityEnabled: z.boolean().optional() }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.companyAdministrator) throw new TRPCError({ code: "FORBIDDEN" });

      const { equityEnabled, ...rest } = input;
      await db.transaction(async (tx) => {
        if (equityEnabled !== undefined) {
          await tx
            .update(companies)
            .set({ ...rest, equityEnabled })
            .where(eq(companies.id, ctx.company.id));
        } else {
          await tx.update(companies).set(rest).where(eq(companies.id, ctx.company.id));
        }

        if (input.logoKey) {
          await tx.delete(activeStorageAttachments).where(companyLogo(ctx.company.id));
          const blob = await tx.query.activeStorageBlobs.findFirst({
            where: eq(activeStorageBlobs.key, input.logoKey),
          });
          if (!blob) throw new TRPCError({ code: "NOT_FOUND", message: "Logo not found" });
          await tx.insert(activeStorageAttachments).values({
            name: "logo",
            blobId: blob.id,
            recordType: "Company",
            recordId: ctx.company.id,
          });
        }
      });
    }),

  listMembers: companyProcedure.input(z.object({ companyId: z.string() })).query(async ({ ctx }) => {
    if (!ctx.companyAdministrator) throw new TRPCError({ code: "FORBIDDEN" });

    // Get role records in parallel for better performance
    const [adminRecords, lawyerRecords, contractorRecords, investorRecords] = await Promise.all([
      db
        .select({
          id: companyAdministrators.id,
          userId: companyAdministrators.userId,
          createdAt: companyAdministrators.createdAt,
        })
        .from(companyAdministrators)
        .where(eq(companyAdministrators.companyId, ctx.company.id)),
      db
        .select({
          id: companyLawyers.id,
          userId: companyLawyers.userId,
          createdAt: companyLawyers.createdAt,
        })
        .from(companyLawyers)
        .where(eq(companyLawyers.companyId, ctx.company.id)),
      db
        .select({
          id: companyContractors.id,
          userId: companyContractors.userId,
          createdAt: companyContractors.createdAt,
        })
        .from(companyContractors)
        .where(eq(companyContractors.companyId, ctx.company.id)),
      db
        .select({
          id: companyInvestors.id,
          userId: companyInvestors.userId,
          createdAt: companyInvestors.createdAt,
        })
        .from(companyInvestors)
        .where(eq(companyInvestors.companyId, ctx.company.id)),
    ]);

    const userIds = new Set<bigint>();
    adminRecords.forEach((record) => userIds.add(record.userId));
    lawyerRecords.forEach((record) => userIds.add(record.userId));
    contractorRecords.forEach((record) => userIds.add(record.userId));
    investorRecords.forEach((record) => userIds.add(record.userId));

    const usersWithRawRoles = await db.query.users.findMany({
      columns: {
        id: true,
        externalId: true,
        email: true,
        legalName: true,
        preferredName: true,
      },
      where: (usersTable) => inArray(usersTable.id, Array.from(userIds)),
    });

    const adminMap = new Set(adminRecords.map((record) => record.userId));
    const lawyerMap = new Set(lawyerRecords.map((record) => record.userId));

    // Get the primary admin (owner) - first admin by ID (matches Rails primary_admin logic)
    // Tech Debt(Smit) | Strategy Required: Ownership Transfer might fail this?
    let primaryAdminUserId: bigint | null = null;
    if (adminRecords.length > 0) {
      adminRecords.sort((a, b) => {
        if (a.id < b.id) return -1;
        if (a.id > b.id) return 1;
        return 0;
      });
      primaryAdminUserId = adminRecords[0]?.userId ?? null;
    }

    const results: UserWithRoleInfo[] = usersWithRawRoles.map((user) => {
      const isAdmin = adminMap.has(user.id);
      const isLawyer = lawyerMap.has(user.id);
      const isOwner = isAdmin && user.id === primaryAdminUserId;
      const isMember = !isAdmin && !isLawyer;

      let role: UserWithRoleInfo["role"] = "Member";
      if (isOwner) {
        role = "Owner";
      } else if (isAdmin) {
        role = "Admin";
      } else if (isLawyer) {
        role = "Lawyer";
      }

      return {
        id: user.externalId,
        email: user.email,
        name: user.legalName ?? user.preferredName ?? user.email,
        isAdmin,
        isLawyer,
        isMember,
        role,
        isOwner,
      };
    });

    // Owner first, then Admins by name, then Lawyers by name
    // (Smit)Ask Reviewer: Can be just by name for others for simplicity
    return results.sort((a, b) => {
      if (a.isOwner !== b.isOwner) return a.isOwner ? -1 : 1;
      if (a.isAdmin !== b.isAdmin) return a.isAdmin ? -1 : 1;
      if (a.isLawyer !== b.isLawyer) return a.isLawyer ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }),

  inviteMembers: companyProcedure.input(workspaceRoledInvitationsSchema).mutation(async ({ ctx, input }) => {
    if (!ctx.companyAdministrator) {
      throw new TRPCError({ code: "FORBIDDEN", message: "You don't have permission to invite members" });
    }

    try {
      const response = await fetch(
        company_administrator_settings_workspace_members_url(ctx.company.externalId, { host: ctx.host }),
        {
          method: "POST",
          body: JSON.stringify(input),
          headers: { "Content-Type": "application/json", ...ctx.headers },
        },
      );

      if (!response.ok) {
        // Handle permission errors (403 Forbidden) - only possible backend error with frontend validation
        if (response.status === 403) {
          const { errors } = z.object({ errors: z.array(z.string()) }).parse(await response.json());
          throw new TRPCError({ code: "FORBIDDEN", message: errors.join(", ") });
        }

        // Handle server/database errors (422/500) - rare but possible
        try {
          const json = await response.json();
          console.log("🚀 ~ json:", json);
          const { error } = z.object({ error: z.string() }).parse(json);
          throw new TRPCError({ code: "BAD_REQUEST", message: error });
        } catch (error) {
          console.log("🚀 ~ error:", error.message);
          // Fallback for unexpected error formats
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Server error occurred" });
        }
      }

      // Success case - parse and return the structured response
      const successResponse = z
        .object({
          success: z.literal(true),
          invited_count: z.number(),
          updated_count: z.number(),
          total_processed: z.number(),
        })
        .parse(await response.json());
      return successResponse;
    } catch (error) {
      // Re-throw TRPCErrors as-is
      if (error instanceof TRPCError) {
        throw error;
      }

      // Handle network/fetch errors
      if (error instanceof TypeError && error.message.includes("fetch")) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Network error occurred" });
      }

      // Handle JSON parsing errors
      if (error instanceof SyntaxError) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Invalid response from server" });
      }

      // Handle other unexpected errors
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "An unexpected error occurred" });
    }
  }),

  changeMemberRole: companyProcedure.input(workspaceMemberSchema).mutation(async ({ ctx, input }) => {
    if (!ctx.companyAdministrator) {
      throw new TRPCError({ code: "FORBIDDEN" });
    }

    const targetUser = await db.query.users.findFirst({
      where: eq(users.externalId, input.userId),
      with: {
        companyAdministrators: {
          where: eq(companyAdministrators.companyId, ctx.company.id),
        },
        companyLawyers: {
          where: eq(companyLawyers.companyId, ctx.company.id),
        },
      },
    });

    if (!targetUser) throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });

    if (!["Admin", "Lawyer"].includes(input.role)) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Invalid role: ${input.role}`,
      });
    }

    const targetUserId = targetUser.id;
    const isCurrentlyAdmin = targetUser.companyAdministrators.length > 0;
    const isCurrentlyLawyer = targetUser.companyLawyers.length > 0;
    const targetRole = input.role;

    // before feature release bad state cleanup
    const deleteLawyer = isCurrentlyAdmin && isCurrentlyLawyer;

    if ((targetRole === "Admin" && isCurrentlyAdmin) || (targetRole === "Lawyer" && isCurrentlyLawyer)) {
      return;
    }

    await db.transaction(async (tx) => {
      if (targetRole === "Admin") {
        if (isCurrentlyLawyer || deleteLawyer) {
          await tx
            .delete(companyLawyers)
            .where(and(eq(companyLawyers.userId, targetUserId), eq(companyLawyers.companyId, ctx.company.id)));
        }
        await tx.insert(companyAdministrators).values({
          userId: targetUserId,
          companyId: ctx.company.id,
        });
      } else {
        if (isCurrentlyAdmin) {
          await tx
            .delete(companyAdministrators)
            .where(
              and(eq(companyAdministrators.userId, targetUserId), eq(companyAdministrators.companyId, ctx.company.id)),
            );
        }
        await tx.insert(companyLawyers).values({
          userId: targetUserId,
          companyId: ctx.company.id,
        });
      }
    });
  }),

  // Keep the original database-based admin role revocation for backward compatibility
  revokeWorkspaceMemberRole: companyProcedure
    .input(z.object({ companyId: z.string(), userId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.companyAdministrator) throw new TRPCError({ code: "FORBIDDEN" });

      // Find user by external_id
      const targetUser = await db.query.users.findFirst({
        where: eq(users.externalId, input.userId),
      });
      if (!targetUser) throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });

      const targetUserId = targetUser.id;

      // Check if trying to remove own admin role
      if (BigInt(ctx.userId) === targetUserId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "You cannot remove your own role",
        });
      }

      // Check if this would remove the last administrator
      const currentAdmins = await db.query.companyAdministrators.findMany({
        where: eq(companyAdministrators.companyId, ctx.company.id),
      });

      const isTargetAdmin = currentAdmins.some((admin) => admin.userId === targetUserId);

      if (isTargetAdmin && currentAdmins.length === 1) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot remove the last administrator",
        });
      }

      // Remove both admin and lawyer roles in a transaction
      await db.transaction(async (tx) => {
        await tx
          .delete(companyAdministrators)
          .where(
            and(eq(companyAdministrators.userId, targetUserId), eq(companyAdministrators.companyId, ctx.company.id)),
          );

        await tx
          .delete(companyLawyers)
          .where(and(eq(companyLawyers.userId, targetUserId), eq(companyLawyers.companyId, ctx.company.id)));
      });
    }),

  // --- Microdeposit Verification ---
  microdepositVerificationDetails: companyProcedure.query(async ({ ctx }) => {
    if (!ctx.companyAdministrator) throw new TRPCError({ code: "FORBIDDEN" });

    const response = await fetch(
      microdeposit_verification_details_company_invoices_url(ctx.company.externalId, { host: ctx.host }),
      { headers: ctx.headers },
    );
    const data = z
      .object({
        details: z
          .object({
            arrival_timestamp: z.number(),
            microdeposit_type: z.enum(["descriptor_code", "amounts"]),
            bank_account_number: z.string().nullable(),
          })
          .nullable(),
      })
      .parse(await response.json());
    return { microdepositVerificationDetails: data.details };
  }),

  microdepositVerification: companyProcedure
    .input(z.object({ code: z.string() }).or(z.object({ amounts: z.array(z.number()) })))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.companyAdministrator) throw new TRPCError({ code: "FORBIDDEN" });

      const response = await fetch(
        company_administrator_stripe_microdeposit_verifications_url(ctx.company.externalId, { host: ctx.host }),
        {
          method: "POST",
          body: JSON.stringify(input),
          headers: { "Content-Type": "application/json", ...ctx.headers },
        },
      );

      if (!response.ok) {
        const { error } = z.object({ error: z.string() }).parse(await response.json());
        throw new TRPCError({ code: "BAD_REQUEST", message: error });
      }
    }),
});
