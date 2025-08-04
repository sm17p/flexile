"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { getFilteredRowModel } from "@tanstack/react-table";
import { TRPCError } from "@trpc/server";
import { MoreHorizontal, Plus, Scale, SendHorizontal, ShieldUser, Trash2, UserPlus, X } from "lucide-react";
import { useSearchParams } from "next/navigation";
import React, { useCallback, useMemo, useState } from "react";
import { useFieldArray, useForm, type UseFormSetError } from "react-hook-form";
import z from "zod";
import ComboBox from "@/components/ComboBox";
import DataTable, { createColumnHelper, useTable } from "@/components/DataTable";
import { MutationStatusButton } from "@/components/MutationButton";
import TableSkeleton from "@/components/TableSkeleton";
import { Badge } from "@/components/ui/badge";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useCurrentCompany, useCurrentUser } from "@/global";
import { trpc, workspaceMemberRoles } from "@/trpc/client";
import { ERROR_MESSAGES } from "@/utils/errorMessages";

const MAX_LIMIT_FOR_BULK = 100;
const MAX_LIMIT_EMAILS_ERROR = ERROR_MESSAGES.TOO_MANY_EMAILS.replace("{limit}", MAX_LIMIT_FOR_BULK.toString());

const invitedWorkspaceMemberSchema = z.object({
  email: z.string().min(1, "Email address is required").email("Please enter a valid email address"),
  role: z.enum(workspaceMemberRoles, {
    errorMap: (issue, ctx) => {
      if (issue.code === z.ZodIssueCode.invalid_enum_value) {
        return { message: "Please select a valid role" };
      }
      return { message: ctx.defaultError };
    },
  }),
});

const workspaceRoledInvitationsSchema = z.object({
  bulkEmails: z.string().optional(),
  defaultRole: invitedWorkspaceMemberSchema.shape.role,
  members: z
    .array(invitedWorkspaceMemberSchema)
    .min(1, "At least one member is required")
    .max(MAX_LIMIT_FOR_BULK, MAX_LIMIT_EMAILS_ERROR),
});

const WORKSPACE_ROLE_OPTIONS = workspaceMemberRoles
  .filter((role) => role === workspaceMemberRoles[1] || role === workspaceMemberRoles[2])
  .map((role) => ({
    value: role,
    label: role,
  }));

type WorkspaceMember = z.infer<typeof invitedWorkspaceMemberSchema>;
type WorkspaceInvitationForm = z.infer<typeof workspaceRoledInvitationsSchema>;

export function validateBulkEmails(
  bulkEmails: string,
  setError: UseFormSetError<WorkspaceInvitationForm>,
): { isValid: boolean; emails: string[] } {
  if (!bulkEmails.trim()) {
    return { isValid: true, emails: [] };
  }

  const emails = bulkEmails
    .split(/[,\n]/u)
    .map((email) => email.trim())
    .filter((email) => email.length > 0);

  if (emails.length > MAX_LIMIT_FOR_BULK) {
    const message = ERROR_MESSAGES.TOO_MANY_EMAILS.replace("{limit}", MAX_LIMIT_FOR_BULK.toString());
    setError("bulkEmails", { message });
    return { isValid: false, emails: [] };
  }

  const zEmail = z.string().email();
  const invalidEmails = emails.filter((email) => {
    try {
      zEmail.parse(email);
      return false;
    } catch {
      return true;
    }
  });

  if (invalidEmails.length > 0) {
    const message = `Invalid email format: ${invalidEmails.slice(0, 3).join(", ")}${invalidEmails.length > 3 ? ` and ${invalidEmails.length - 3} more` : ""}`;
    setError("bulkEmails", { message });
    return { isValid: false, emails: [] };
  }

  const duplicates = emails.filter((email, index) => emails.indexOf(email) !== index);
  if (duplicates.length > 0) {
    const message = `Duplicate emails found: ${[...new Set(duplicates)].slice(0, 3).join(", ")}`;
    setError("bulkEmails", { message });
    return { isValid: false, emails: [] };
  }

  return { isValid: true, emails };
}

function formatInviteSuccessMessage(invitedCount: number, updatedCount: number): string {
  if (invitedCount === 0 && updatedCount === 0) {
    return "No changes were made";
  }

  const parts: string[] = [];
  if (invitedCount > 0) {
    parts.push(`${invitedCount} ${invitedCount === 1 ? "member" : "members"} invited`);
  }
  if (updatedCount > 0) {
    parts.push(`${updatedCount} ${updatedCount === 1 ? "role" : "roles"} updated`);
  }

  return parts.join(" and ");
}

export default function MembersPage() {
  const searchParams = useSearchParams();
  const addMemberModalViaNavigation = Boolean(searchParams.get("addMembers"));
  const company = useCurrentCompany();
  const currentUser = useCurrentUser();
  const { data: users = [], isLoading } = trpc.companies.listMembers.useQuery({ companyId: company.id });

  const [showAddMemberModal, setShowAddMemberModal] = useState(addMemberModalViaNavigation);
  const [confirmRevokeUser, setConfirmRevokeUser] = useState<(typeof users)[number] | null>(null);
  const [generalError, setGeneralError] = useState<string>("");
  const [successMessage, setSuccessMessage] = useState<string>("");

  const inviteMembersForm = useForm<WorkspaceInvitationForm>({
    resolver: zodResolver(
      workspaceRoledInvitationsSchema.superRefine((data) => {
        if (data.members.length < 1) {
          setGeneralError("At least one member is required");
        } else if (data.members.length > MAX_LIMIT_FOR_BULK) {
          setGeneralError(MAX_LIMIT_EMAILS_ERROR);
        } else {
          setGeneralError("");
        }
      }),
    ),
    defaultValues: {
      bulkEmails: "",
      defaultRole: "Lawyer",
      members: [{ email: "", role: "Lawyer" }],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: inviteMembersForm.control,
    name: "members",
  });

  const trpcUtils = trpc.useUtils();

  const setBackendErrorsOnForm = useCallback<(error: unknown) => string | null>(
    (error) => {
      if (error instanceof TRPCError) {
        if (error.code === "FORBIDDEN") {
          inviteMembersForm.setError("root", { type: "manual", message: error.message });
          return error.message;
        }

        if (error.code === "BAD_REQUEST") {
          inviteMembersForm.setError("root", { type: "manual", message: error.message });
          return error.message;
        }

        inviteMembersForm.setError("root", { type: "manual", message: error.message });
        return error.message;
      }

      const message = ERROR_MESSAGES.SERVER_ERROR;
      inviteMembersForm.setError("root", { type: "manual", message });
      return message;
    },
    [inviteMembersForm.setError],
  );

  const inviteMember = trpc.companies.inviteMembers.useMutation({
    onSuccess: (data) => {
      setGeneralError("");

      const message = formatInviteSuccessMessage(data.invited_count, data.updated_count);
      setSuccessMessage(message);

      inviteMembersForm.reset({
        bulkEmails: "",
        defaultRole: "Lawyer",
        members: [{ email: "", role: "Lawyer" }],
      });

      setTimeout(() => {
        setSuccessMessage("");
        setShowAddMemberModal(false);
        void trpcUtils.companies.listMembers.invalidate();
      }, 3500);
    },
    onError: (error) => {
      inviteMembersForm.clearErrors();
      setGeneralError("");
      const errorMessage = setBackendErrorsOnForm(error);
      if (errorMessage) {
        setGeneralError(errorMessage);
      }
    },
  });

  const revokeRoleMutation = trpc.companies.revokeWorkspaceMemberRole.useMutation({
    onMutate: async () => {
      await trpcUtils.companies.listMembers.cancel({ companyId: company.id });
    },
    onSettled: async () => {
      await trpcUtils.companies.listMembers.invalidate();
    },
  });

  const changeRoleMutation = trpc.companies.changeMemberRole.useMutation({
    onMutate: async () => {
      await trpcUtils.companies.listMembers.cancel({ companyId: company.id });
    },
    onSettled: async () => {
      await trpcUtils.companies.listMembers.invalidate();
    },
  });

  const submitInviteMembers = useCallback(
    inviteMembersForm.handleSubmit(async ({ members }) => {
      setGeneralError("");
      setSuccessMessage("");
      inviteMembersForm.clearErrors();
      return inviteMember.mutateAsync({ companyId: company.id, members });
    }),
    [inviteMember, inviteMembersForm, company.id],
  );

  const addEmailField = useCallback(() => {
    const defaultRole = inviteMembersForm.getValues("defaultRole");
    append({ email: "", role: defaultRole });
  }, [inviteMembersForm, append]);

  const removeEmailField = useCallback(
    (index: number) => {
      if (fields.length > 1) {
        remove(index);
      }
    },
    [fields.length, remove],
  );

  const processBulkEmails = useCallback(() => {
    const bulkEmails = inviteMembersForm.getValues("bulkEmails");
    const defaultRole = inviteMembersForm.getValues("defaultRole");

    inviteMembersForm.clearErrors("bulkEmails");

    const { isValid, emails } = validateBulkEmails(bulkEmails ?? "", inviteMembersForm.setError);

    if (!isValid || emails.length === 0) {
      return;
    }

    const processedEntries: WorkspaceMember[] = emails.map((email: string) => ({
      email,
      role: defaultRole,
    }));

    inviteMembersForm.setValue("members", processedEntries);
    inviteMembersForm.setValue("bulkEmails", "");
  }, [inviteMembersForm]);

  const columnHelper = createColumnHelper<(typeof users)[number]>();
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
              <div className="text-muted-foreground text-xs">{user.email}</div>
            </div>
          );
        },
        filterFn: (row, _, filterValue: string) => {
          const searchableRowContent = `${row.original.name} ${row.original.email}`;
          return searchableRowContent.toLowerCase().includes(filterValue.toLowerCase());
        },
      }),
      columnHelper.accessor("role", {
        header: "Role",
        cell: (info) => {
          const user = info.row.original;
          const role = info.getValue();
          const isLoading = changeRoleMutation.isPending && changeRoleMutation.variables.userId === user.id;

          let variant: "default" | "secondary" | "outline" = "secondary";
          if (role === "Owner") variant = "default";
          else if (role === "Admin") variant = "outline";
          else if (role === "Lawyer") variant = "outline";

          return (
            <div className="inline-flex md:w-24">
              {isLoading ? "Switching..." : <Badge variant={variant}>{role}</Badge>}
            </div>
          );
        },
      }),
      columnHelper.display({
        id: "actions",
        header: "",
        cell: (info) => {
          const user = info.row.original;
          const role = user.role;
          const owner = role === workspaceMemberRoles[0];
          const admin = role === workspaceMemberRoles[1];
          const lawyer = role === workspaceMemberRoles[2];
          const member = role === workspaceMemberRoles[3];

          if (owner) {
            return null;
          }

          const isCurrentUserRow = currentUser.email === user.email;
          const isLoadingRevoke = revokeRoleMutation.isPending && revokeRoleMutation.variables.userId === user.id;
          const isLoadingChangeRole = changeRoleMutation.isPending && changeRoleMutation.variables.userId === user.id;
          const adminCount = users.filter((u) => u.isAdmin).length;
          const isLastAdmin = adminCount === 1 && user.isAdmin;

          return (
            <div className="text-left">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="small"
                    className="size-8 p-0"
                    disabled={isCurrentUserRow || isLoadingRevoke || isLoadingChangeRole || isLastAdmin}
                  >
                    <span className="sr-only">Open menu</span>
                    <MoreHorizontal className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {(admin || member) && !lawyer ? (
                    <DropdownMenuItem
                      onClick={() =>
                        changeRoleMutation.mutate({
                          companyId: company.id,
                          userId: user.id,
                          role: "Lawyer",
                        })
                      }
                    >
                      <Scale className="size-4" />
                      Make Lawyer
                    </DropdownMenuItem>
                  ) : null}
                  {(lawyer || member) && !admin ? (
                    <DropdownMenuItem
                      onClick={() =>
                        changeRoleMutation.mutate({
                          companyId: company.id,
                          userId: user.id,
                          role: "Admin",
                        })
                      }
                    >
                      <ShieldUser className="size-4" />
                      Make Admin
                    </DropdownMenuItem>
                  ) : null}
                  {admin || lawyer ? (
                    <DropdownMenuItem
                      className="text-destructive hover:text-destructive"
                      onClick={() => setConfirmRevokeUser(user)}
                    >
                      <Trash2 className="text-destructive size-4" />
                      Revoke Role
                    </DropdownMenuItem>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          );
        },
      }),
    ],
    [currentUser.email, company.id, revokeRoleMutation, changeRoleMutation, users],
  );

  const table = useTable({
    columns,
    getRowId: (user) => user.id,
    getFilteredRowModel: getFilteredRowModel(),
    data: users,
  });

  return (
    <>
      <div className="grid gap-8">
        <hgroup>
          <h2 className="mb-1 text-xl font-bold">Roles</h2>
          <p className="text-muted-foreground text-sm">Use roles to grant deeper access to your workspace.</p>
        </hgroup>
        <div className="md:[&_td:first-child]:!pl-0 [&_td:last-child]:w-14 md:[&_td:last-child]:!pr-0 md:[&_th:first-child]:!pl-0 [&_th:last-child]:w-14 md:[&_th:last-child]:!pr-0">
          {isLoading ? (
            <TableSkeleton columns={3} />
          ) : (
            <DataTable
              table={table}
              searchColumn="name"
              searchColumnPlaceholder="Search by name or email..."
              actions={
                <Button className="text-sm" onClick={() => setShowAddMemberModal(true)} size="small" variant="outline">
                  <UserPlus className="size-4" />
                  Add Members
                </Button>
              }
            />
          )}
        </div>
      </div>

      <Dialog
        open={showAddMemberModal}
        onOpenChange={(open) => {
          setShowAddMemberModal(open);
          if (!open) {
            setGeneralError("");
            setSuccessMessage("");
            inviteMembersForm.clearErrors();
          }
        }}
      >
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="text-xl">Add members</DialogTitle>
            <DialogDescription>
              Invite one or more people to join your workspace. You can add multiple email addresses.
            </DialogDescription>
          </DialogHeader>
          <Form {...inviteMembersForm}>
            <form onSubmit={(e) => void submitInviteMembers(e)} className="grid gap-y-4">
              <FormField
                control={inviteMembersForm.control}
                name="defaultRole"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Default role</FormLabel>
                    <FormControl>
                      <ComboBox
                        options={WORKSPACE_ROLE_OPTIONS}
                        value={field.value}
                        onChange={field.onChange}
                        placeholder="Select default role"
                        size="small"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid gap-y-2">
                <FormField
                  control={inviteMembersForm.control}
                  name="bulkEmails"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Bulk add emails (comma-separated)</FormLabel>
                      <FormControl>
                        <Textarea
                          {...field}
                          className="w-full"
                          placeholder="user1@gmail.com, user2@gmail.com, user3@gmail.com"
                          rows={3}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                {inviteMembersForm.watch("bulkEmails")?.trim() ? (
                  <Button type="button" variant="outline" size="small" onClick={processBulkEmails} className="w-full">
                    Process emails
                  </Button>
                ) : null}
              </div>
              <div className="grid gap-y-2">
                <Label>Individual email addresses and roles</Label>
                {fields.map((field, index) => (
                  <div key={field.id} className="flex gap-2">
                    <FormField
                      control={inviteMembersForm.control}
                      name={`members.${index}.email`}
                      render={({ field: emailField }) => (
                        <FormItem className="flex-1">
                          <FormControl>
                            <Input placeholder="Enter email address" {...emailField} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={inviteMembersForm.control}
                      name={`members.${index}.role`}
                      render={({ field: roleField }) => (
                        <FormItem className="w-32">
                          <FormControl>
                            <ComboBox
                              className="max-h-9"
                              options={WORKSPACE_ROLE_OPTIONS}
                              value={roleField.value}
                              onChange={roleField.onChange}
                              placeholder="Select role"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    {fields.length > 1 && (
                      <Button
                        className="max-h-9 px-3"
                        onClick={() => removeEmailField(index)}
                        size="small"
                        type="button"
                        variant="outline"
                      >
                        <X className="size-4" />
                      </Button>
                    )}
                  </div>
                ))}

                <Button
                  className="w-full"
                  size="small"
                  onClick={addEmailField}
                  disabled={fields.length === MAX_LIMIT_FOR_BULK}
                  type="button"
                  variant={fields.length === MAX_LIMIT_FOR_BULK ? "ghost" : "outline"}
                >
                  {fields.length === MAX_LIMIT_FOR_BULK ? (
                    MAX_LIMIT_EMAILS_ERROR
                  ) : (
                    <>
                      <Plus className="size-4" />
                      Add another member
                    </>
                  )}
                </Button>
              </div>

              {successMessage.length > 0 && (
                <div className="rounded-md border border-green-200 bg-green-50 p-4">
                  <div className="flex">
                    <div className="flex-shrink-0">
                      <svg className="h-5 w-5 text-green-400" viewBox="0 0 20 20" fill="currentColor">
                        <path
                          fillRule="evenodd"
                          d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                          clipRule="evenodd"
                        />
                      </svg>
                    </div>
                    <div className="ml-3">
                      <p className="text-sm font-medium text-green-800">{successMessage}</p>
                    </div>
                  </div>
                </div>
              )}

              {generalError.length > 0 && (
                <div className="rounded-md border border-red-200 bg-red-50 p-4">
                  <div className="flex">
                    <div className="flex-shrink-0">
                      <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                        <path
                          fillRule="evenodd"
                          d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                          clipRule="evenodd"
                        />
                      </svg>
                    </div>
                    <div className="ml-3">
                      <p className="text-sm font-medium text-red-800">{generalError}</p>
                    </div>
                  </div>
                </div>
              )}

              <div className="flex w-full justify-between">
                <Button
                  size="small"
                  variant="outline"
                  type="reset"
                  onClick={() => {
                    inviteMembersForm.reset();
                    inviteMembersForm.clearErrors();
                    setGeneralError("");
                    setSuccessMessage("");
                  }}
                >
                  Reset
                </Button>
                <MutationStatusButton type="submit" mutation={inviteMember} loadingText="Adding members...">
                  <SendHorizontal className="size-4" />
                  Add {fields.length} {fields.length === 1 ? "Member" : "Members"}
                </MutationStatusButton>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!confirmRevokeUser} onOpenChange={() => setConfirmRevokeUser(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              Remove {confirmRevokeUser?.role.toLowerCase()} access for{" "}
              <span className="font-medium">{confirmRevokeUser?.name || confirmRevokeUser?.email}</span>?
            </DialogTitle>
            <DialogDescription>
              This will revoke their {confirmRevokeUser?.role.toLowerCase()} privileges. They'll still be a member of
              the workspace.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmRevokeUser(null)}>
              Cancel
            </Button>
            <Button
              variant="critical"
              onClick={() => {
                if (confirmRevokeUser) {
                  revokeRoleMutation.mutate({
                    companyId: company.id,
                    userId: confirmRevokeUser.id,
                  });
                  setConfirmRevokeUser(null);
                }
              }}
            >
              Remove {confirmRevokeUser?.role.toLowerCase()}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
