import { z } from "zod";

export const userSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  isInvestor: z.boolean().optional(),
  isContractor: z.boolean().optional(),
  isAdministrator: z.boolean().optional(),
  isLawyer: z.boolean().optional(),
});

export const usersWithoutRoleSchema = z.object({
  companyId: z.string(),
  excludeRoledUserIds: z.array(z.string()).optional(),
});

export type UserWithoutRoleInfo = z.infer<typeof userSchema>;
