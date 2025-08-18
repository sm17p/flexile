"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { getFilteredRowModel, getSortedRowModel } from "@tanstack/react-table";
import { MoreHorizontal, Plus, SendHorizonal } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import ComboBox from "@/components/ComboBox";
import DataTable, { createColumnHelper, useTable } from "@/components/DataTable";
import { MutationStatusButton } from "@/components/MutationButton";
import TableSkeleton from "@/components/TableSkeleton";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useCurrentCompany, useCurrentUser } from "@/global";
import { trpc } from "@/trpc/client";
import WorkspaceUserComboBox from "./WorkspaceUserComboBox";

const addWorkspaceMemberSchema = z.object({
  user: z.object({
    id: z.string().or(z.undefined()),
    name: z.string(),
    email: z.string().min(1, "Please select a valid user").email("Please enter a valid email address"),
    isContractor: z.boolean(),
    isInvestor: z.boolean(),
    isAdministrator: z.boolean(),
    isLawyer: z.boolean(),
  }),
  role: z.enum(["admin", "lawyer"]),
});

type WorkspaceMemberAdditionForm = z.infer<typeof addWorkspaceMemberSchema>;

export default function RolesPage() {
  const company = useCurrentCompany();
  const currentUser = useCurrentUser();
  const [showAddModal, setShowAddModal] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState<{ id: string; name: string; role: string } | null>(null);
  const trpcUtils = trpc.useUtils();

  const { data: adminsAndLawyers = [] } = trpc.companies.listCompanyUsers.useQuery({
    companyId: company.id,
    roles: ["administrators", "lawyers"],
  });

  const { data: workspaceUsers = [] } = trpc.workspaceRoles.usersWithoutRole.useQuery({
    companyId: company.id,
    excludeRoledUserIds: adminsAndLawyers.map((user) => user.id),
  });

  const addRoleMutation = trpc.companies.addRole.useMutation({
    onError: (error) => {
      addMemberForm.clearErrors();
      addMemberForm.setError("user", { message: error.message });
    },
    onMutate: () => {
      void trpcUtils.companies.listCompanyUsers.cancel({ companyId: company.id, roles: ["administrators", "lawyers"] });
    },
    onSuccess: async () => {
      await trpcUtils.companies.listCompanyUsers.invalidate();
      setShowAddModal(false);
      addMemberForm.reset();
    },
  });

  const inviteLawyerMutation = trpc.lawyers.invite.useMutation({
    onError: (error) => {
      addMemberForm.clearErrors();
      addMemberForm.setError("user", { message: error.message });
    },
    onMutate: () => {
      void trpcUtils.companies.listCompanyUsers.cancel({ companyId: company.id, roles: ["administrators", "lawyers"] });
    },
    onSuccess: async () => {
      await trpcUtils.companies.listCompanyUsers.invalidate();
      setShowAddModal(false);
      addMemberForm.reset();
    },
  });

  const inviteAdminMutation = trpc.administrators.invite.useMutation({
    onError: (error) => {
      addMemberForm.clearErrors();
      addMemberForm.setError("user", { message: error.message });
    },
    onMutate: () => {
      void trpcUtils.companies.listCompanyUsers.cancel({ companyId: company.id, roles: ["administrators", "lawyers"] });
    },
    onSuccess: async () => {
      await trpcUtils.companies.listCompanyUsers.invalidate();
      setShowAddModal(false);
      addMemberForm.reset();
    },
  });

  const removeRoleMutation = trpc.companies.removeRole.useMutation({
    onSuccess: async () => {
      await trpcUtils.companies.listCompanyUsers.invalidate();
      setConfirmRevoke(null);
    },
  });

  const enrolledMembersEmailSet = useMemo(
    () => new Set(adminsAndLawyers.map((member) => member.email)),
    [adminsAndLawyers],
  );

  const addMemberForm = useForm<WorkspaceMemberAdditionForm>({
    resolver: zodResolver(
      addWorkspaceMemberSchema.superRefine((data, ctx) => {
        if (enrolledMembersEmailSet.has(data.user.email)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Cannot invite members with a role assigned",
            path: ["user"],
          });
        }

        try {
          z.string().email().parse(data.user.email);
        } catch {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Please enter a valid email address",
            path: ["user"],
          });
        }
      }),
    ),
    defaultValues: {
      role: "admin",
    },
  });

  const inviteUserToWorkspace = !useWatch({
    control: addMemberForm.control,
    name: "user.id",
  });

  const selectedRole = useWatch({
    control: addMemberForm.control,
    name: "role",
  });

  const allRoles = useMemo(() => {
    const byId: Record<
      string,
      { id: string; name: string; email: string; role: string; isAdmin: boolean; isOwner: boolean }
    > = {};

    // Separate admins and lawyers from the combined result
    const admins = adminsAndLawyers.filter((user) => user.isAdmin);
    const lawyers = adminsAndLawyers.filter((user) => !user.isAdmin);

    for (const admin of admins) {
      byId[admin.id] = {
        id: admin.id,
        name: admin.name,
        email: admin.email,
        role: admin.role || "Admin",
        isAdmin: admin.isAdmin || false,
        isOwner: admin.isOwner || false,
      };
    }

    for (const lawyer of lawyers) {
      const existing = byId[lawyer.id];
      if (existing) {
        if (existing.role === "Owner") continue;
        existing.role = existing.isAdmin ? "Admin" : "Lawyer";
      } else {
        byId[lawyer.id] = {
          id: lawyer.id,
          name: lawyer.name,
          email: lawyer.email,
          role: lawyer.role || "Lawyer",
          isAdmin: lawyer.isAdmin || false,
          isOwner: lawyer.isOwner || false,
        };
      }
    }

    // Sort the results: Owner first, then by role, then by name
    return Object.values(byId).sort((a, b) => {
      // First: Owner status (Owner first)
      if (a.isOwner !== b.isOwner) return a.isOwner ? -1 : 1;

      // Second: Role priority (Owner > Admin > Lawyer)
      const getRolePriority = (role: string): number => {
        switch (role) {
          case "Owner":
            return 0;
          case "Admin":
            return 1;
          case "Lawyer":
            return 2;
          default:
            return 3;
        }
      };

      const aPriority = getRolePriority(a.role);
      const bPriority = getRolePriority(b.role);
      if (aPriority !== bPriority) return aPriority - bPriority;

      // Third: Name alphabetically
      return a.name.localeCompare(b.name);
    });
  }, [adminsAndLawyers]);

  const columnHelper = createColumnHelper<(typeof allRoles)[number]>();
  const columns = useMemo(
    () => [
      columnHelper.accessor("name", {
        header: "Name",
        cell: (info) => {
          const user = info.row.original;
          const isCurrentUser = currentUser.email === user.email;
          return (
            <div>
              <div className="font-medium">
                {user.name}
                {isCurrentUser ? <span className="text-muted-foreground ml-1">(You)</span> : null}
              </div>
              <div className="text-muted-foreground text-sm">{user.email}</div>
            </div>
          );
        },
      }),
      columnHelper.accessor("role", {
        header: "Role",
        cell: (info) => info.getValue() || "-",
        meta: { cellClassName: "whitespace-nowrap text-left" },
      }),
      columnHelper.display({
        id: "actions",
        header: "",
        cell: (info) => {
          const user = info.row.original;
          if (user.role === "Owner") return null;
          const isCurrentUserRow = currentUser.email === user.email;
          const isLoadingRevoke = removeRoleMutation.isPending && removeRoleMutation.variables.userId === user.id;
          const adminCount = allRoles.filter((u) => u.isAdmin).length;
          const isLastAdmin = adminCount === 1 && user.isAdmin;

          return (
            <div className="pr-2 pl-0 text-right">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="small"
                    className="h-8 w-8 p-0"
                    disabled={isCurrentUserRow || isLoadingRevoke || isLastAdmin}
                  >
                    <span className="sr-only">Open menu</span>
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {user.isAdmin ? (
                    <DropdownMenuItem
                      className="focus:text-destructive hover:text-destructive"
                      onClick={() => setConfirmRevoke({ id: user.id, name: user.name, role: "admin" })}
                    >
                      Remove admin
                    </DropdownMenuItem>
                  ) : null}
                  {user.role.includes("Lawyer") && (
                    <DropdownMenuItem
                      className="focus:text-destructive hover:text-destructive"
                      onClick={() => setConfirmRevoke({ id: user.id, name: user.name, role: "lawyer" })}
                    >
                      Remove lawyer
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          );
        },
      }),
    ],
    [currentUser.email, allRoles, removeRoleMutation],
  );

  const table = useTable({
    columns,
    data: allRoles,
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  // Switch based on selected option
  // For existing user, add role
  // For new user, invite flow
  const addMemberFormSubmit = useCallback(
    addMemberForm.handleSubmit(async ({ user: { id, email }, role }) => {
      addMemberForm.clearErrors();
      if (inviteUserToWorkspace && id) {
        return addRoleMutation.mutateAsync({
          companyId: company.id,
          userId: id,
          role,
        });
      } else if (role === "admin") {
        return inviteAdminMutation.mutateAsync({
          companyId: company.id,
          email,
        });
      }
      return inviteLawyerMutation.mutateAsync({
        companyId: company.id,
        email,
      });
    }),
    [addMemberForm, addRoleMutation, company.id, inviteUserToWorkspace, inviteAdminMutation, inviteLawyerMutation],
  );

  const handleRemoveRole = () => {
    if (confirmRevoke) {
      removeRoleMutation.mutate({
        companyId: company.id,
        userId: confirmRevoke.id,
        role: confirmRevoke.role === "admin" ? "admin" : "lawyer",
      });
    }
  };

  return (
    <>
      <div className="grid gap-8">
        <hgroup>
          <h2 className="mb-1 text-xl font-bold">Roles</h2>
          <p className="text-muted-foreground text-sm">Use roles to grant deeper access to your workspace.</p>
        </hgroup>
        <div className="[&_td:first-child]:!pl-0 [&_td:last-child]:!pr-0 [&_th:first-child]:!pl-0 [&_th:last-child]:!pr-0">
          {adminsAndLawyers.length === 0 ? (
            <TableSkeleton columns={3} />
          ) : (
            <div className="[&_table]:w-full [&_table]:table-fixed [&_td:nth-child(1)]:w-[75%] [&_td:nth-child(2)]:w-[15%] [&_td:nth-child(2)]:pr-1 [&_td:nth-child(2)]:text-left [&_td:nth-child(3)]:w-[10%] [&_td:nth-child(3)]:pr-0 [&_td:nth-child(3)]:pl-0 [&_th:nth-child(1)]:w-[75%] [&_th:nth-child(2)]:w-[15%] [&_th:nth-child(3)]:w-[10%] [&>div>div:first-child]:mx-0">
              <DataTable
                table={table}
                searchColumn="name"
                actions={
                  <Button className="text-sm" onClick={() => setShowAddModal(true)} size="small" variant="outline">
                    <Plus className="size-4" />
                    Add member
                  </Button>
                }
              />
            </div>
          )}
        </div>
      </div>

      {/* Original Add Member Modal */}
      <Dialog open={showAddModal} onOpenChange={setShowAddModal}>
        <DialogContent className="text-black sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="text-xl">Add a member</DialogTitle>
            <DialogDescription className="text-sm text-black">
              Select someone or invite by email to give them the role that fits the work they'll be doing.
            </DialogDescription>
          </DialogHeader>
          <Form {...addMemberForm}>
            <form onSubmit={(e) => void addMemberFormSubmit(e)} className="grid gap-y-4">
              <FormField
                control={addMemberForm.control}
                name="user"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-black">Name or email</FormLabel>
                    <FormControl>
                      <WorkspaceUserComboBox
                        options={workspaceUsers}
                        value={field.value}
                        onChange={field.onChange}
                        placeholder="Search by name or invite by email..."
                        size="small"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={addMemberForm.control}
                name="role"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-black">Role</FormLabel>
                    <FormControl>
                      <ComboBox
                        options={[
                          { value: "admin", label: "Admin" },
                          { value: "lawyer", label: "Lawyer" },
                        ]}
                        value={field.value}
                        onChange={field.onChange}
                        size="small"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="mt-2 flex w-full justify-end">
                {inviteUserToWorkspace ? (
                  <MutationStatusButton type="submit" mutation={addRoleMutation} loadingText="Adding member...">
                    <SendHorizonal className="size-4" />
                    Add Member
                  </MutationStatusButton>
                ) : null}
                {!inviteUserToWorkspace && selectedRole === "lawyer" && (
                  <MutationStatusButton type="submit" mutation={inviteLawyerMutation} loadingText="Adding member...">
                    <SendHorizonal className="size-4" />
                    Add Member
                  </MutationStatusButton>
                )}
                {!inviteUserToWorkspace && selectedRole === "admin" && (
                  <MutationStatusButton type="submit" mutation={inviteAdminMutation} loadingText="Adding member...">
                    <SendHorizonal className="size-4" />
                    Add Member
                  </MutationStatusButton>
                )}
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Remove Role Confirmation Dialog */}
      <Dialog open={!!confirmRevoke} onOpenChange={() => setConfirmRevoke(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              Remove {confirmRevoke?.role === "admin" ? "admin" : "lawyer"} access for{" "}
              <span className="font-medium">{confirmRevoke?.name}</span>?
            </DialogTitle>
            <DialogDescription>
              This will revoke their {confirmRevoke?.role === "admin" ? "admin" : "lawyer"} privileges. They'll still be
              a member of the workspace.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmRevoke(null)}>
              Cancel
            </Button>
            <Button variant="critical" onClick={handleRemoveRole} disabled={removeRoleMutation.isPending}>
              Remove {confirmRevoke?.role === "admin" ? "admin" : "lawyer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
