"use client";
import { skipToken, useQueryClient } from "@tanstack/react-query";
import { type ColumnFiltersState, getFilteredRowModel, getSortedRowModel } from "@tanstack/react-table";
import { BriefcaseBusiness, CircleCheck, Download, FileTextIcon, Info, Pencil, PercentIcon } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryState } from "nuqs";
import React, { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import DocusealForm, { customCss } from "@/app/(dashboard)/documents/DocusealForm";
import { FinishOnboarding } from "@/app/(dashboard)/documents/FinishOnboarding";
import { DashboardHeader } from "@/components/DashboardHeader";
import DataTable, { createColumnHelper, filterValueSchema, useTable } from "@/components/DataTable";
import { linkClasses } from "@/components/Link";
import MutationButton from "@/components/MutationButton";
import Placeholder from "@/components/Placeholder";
import Status, { type Variant as StatusVariant } from "@/components/Status";
import TableSkeleton from "@/components/TableSkeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useCurrentCompany, useCurrentUser } from "@/global";
import { storageKeys } from "@/models/constants";
import type { RouterOutput } from "@/trpc";
import { DocumentTemplateType, DocumentType, trpc } from "@/trpc/client";
import { assertDefined } from "@/utils/assert";
import { formatDate } from "@/utils/time";

type Document = RouterOutput["documents"]["list"][number];
type SignableDocument = Document & { docusealSubmissionId: number };

const typeLabels = {
  [DocumentType.ConsultingContract]: "Agreement",
  [DocumentType.ShareCertificate]: "Certificate",
  [DocumentType.TaxDocument]: "Tax form",
  [DocumentType.ExerciseNotice]: "Exercise notice",
  [DocumentType.EquityPlanContract]: "Equity plan",
};

const templateTypeLabels = {
  [DocumentTemplateType.ConsultingContract]: "Agreement",
  [DocumentTemplateType.EquityPlanContract]: "Equity plan",
};

const columnFiltersSchema = z.array(z.object({ id: z.string(), value: filterValueSchema }));

const getCompletedAt = (document: Document) =>
  document.signatories.every((signatory) => signatory.signedAt)
    ? document.signatories.reduce<Date | null>(
        (acc, signatory) =>
          acc ? (signatory.signedAt && signatory.signedAt > acc ? signatory.signedAt : acc) : signatory.signedAt,
        null,
      )
    : undefined;

function getStatus(document: Document): { variant: StatusVariant | undefined; name: string; text: string } {
  const completedAt = getCompletedAt(document);

  switch (document.type) {
    case DocumentType.TaxDocument:
      if (document.name.startsWith("W-") || completedAt) {
        return {
          variant: "success",
          name: "Signed",
          text: completedAt ? `Filed on ${formatDate(completedAt)}` : "Signed",
        };
      }
      return { variant: undefined, name: "Ready for filing", text: "Ready for filing" };
    case DocumentType.ShareCertificate:
    case DocumentType.ExerciseNotice:
      return { variant: "success", name: "Issued", text: "Issued" };
    case DocumentType.ConsultingContract:
    case DocumentType.EquityPlanContract:
      return completedAt
        ? { variant: "success", name: "Signed", text: "Signed" }
        : { variant: "critical", name: "Signature required", text: "Signature required" };
  }
}

const EditTemplates = () => {
  const company = useCurrentCompany();
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [templates, { refetch: refetchTemplates }] = trpc.documents.templates.list.useSuspenseQuery({
    companyId: company.id,
  });
  const filteredTemplates = useMemo(
    () =>
      company.id && templates.length > 1
        ? templates.filter(
            (template) => !template.generic || !templates.some((t) => !t.generic && t.type === template.type),
          )
        : templates,
    [templates],
  );
  const createTemplate = trpc.documents.templates.create.useMutation({
    onSuccess: (id) => {
      void refetchTemplates();
      router.push(`/document_templates/${id}`);
    },
  });

  return (
    <>
      <Button variant="outline" size="small" onClick={() => setOpen(true)}>
        <Pencil className="size-4" />
        Edit templates
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit templates</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredTemplates.map((template) => (
                  <TableRow key={template.id}>
                    <TableCell>
                      <Link href={`/document_templates/${template.id}`} className="after:absolute after:inset-0">
                        {template.name}
                      </Link>
                    </TableCell>
                    <TableCell>{templateTypeLabels[template.type]}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <h3 className="text-lg font-medium">Create a new template</h3>
            <Alert className="mx-4">
              <Info className="size-4" />
              <AlertDescription>
                By creating a custom document template, you acknowledge that Flexile shall not be liable for any claims,
                liabilities, or damages arising from or related to such documents. See our{" "}
                <Link href="/terms" className="text-blue-600 hover:underline">
                  Terms of Service
                </Link>{" "}
                for more details.
              </AlertDescription>
            </Alert>
            <div className="grid grid-cols-3 gap-4">
              <MutationButton
                idleVariant="outline"
                className="h-auto rounded-md p-6"
                mutation={createTemplate}
                param={{
                  companyId: company.id,
                  name: "Consulting agreement",
                  type: DocumentTemplateType.ConsultingContract,
                }}
              >
                <div className="flex flex-col items-center">
                  <FileTextIcon className="size-6" />
                  <span className="mt-2 whitespace-normal">Consulting agreement</span>
                </div>
              </MutationButton>
              <MutationButton
                idleVariant="outline"
                className="h-auto rounded-md p-6"
                mutation={createTemplate}
                param={{
                  companyId: company.id,
                  name: "Equity grant contract",
                  type: DocumentTemplateType.EquityPlanContract,
                }}
              >
                <div className="flex flex-col items-center">
                  <PercentIcon className="size-6" />
                  <span className="mt-2 whitespace-normal">Equity grant contract</span>
                </div>
              </MutationButton>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default function DocumentsPage() {
  const user = useCurrentUser();
  const company = useCurrentCompany();
  const isCompanyRepresentative = !!user.roles.administrator || !!user.roles.lawyer;
  const userId = isCompanyRepresentative ? null : user.id;
  const canSign = user.address.street_address || isCompanyRepresentative;

  const [forceWorkerOnboarding, setForceWorkerOnboarding] = useState<boolean>(
    user.roles.worker ? !user.roles.worker.role : false,
  );

  const currentYear = new Date().getFullYear();
  const { data: documents = [], isLoading } = trpc.documents.list.useQuery({ companyId: company.id, userId });

  const columnHelper = createColumnHelper<Document>();
  const [downloadDocument, setDownloadDocument] = useState<bigint | null>(null);
  const { data: downloadUrl } = trpc.documents.getUrl.useQuery(
    downloadDocument ? { companyId: company.id, id: downloadDocument } : skipToken,
  );
  const [signDocumentParam] = useQueryState("sign");
  const [signDocumentId, setSignDocumentId] = useState<bigint | null>(null);
  const isSignable = (document: Document): document is SignableDocument =>
    !!document.docusealSubmissionId &&
    document.signatories.some(
      (signatory) =>
        !signatory.signedAt &&
        (signatory.id === user.id || (signatory.title === "Company Representative" && isCompanyRepresentative)),
    );
  const signDocument = signDocumentId
    ? documents.find((document): document is SignableDocument => document.id === signDocumentId && isSignable(document))
    : null;
  useEffect(() => {
    const document = signDocumentParam ? documents.find((document) => document.id === BigInt(signDocumentParam)) : null;
    if (canSign && document && isSignable(document)) setSignDocumentId(document.id);
  }, [documents, signDocumentParam]);
  useEffect(() => {
    if (downloadUrl) window.location.href = downloadUrl;
  }, [downloadUrl]);

  const columns = useMemo(
    () =>
      [
        isCompanyRepresentative
          ? columnHelper.accessor(
              (row) =>
                assertDefined(row.signatories.find((signatory) => signatory.title !== "Company Representative")).name,
              { header: "Signer" },
            )
          : null,
        columnHelper.simple("name", "Document"),
        columnHelper.accessor((row) => typeLabels[row.type], {
          header: "Type",
          meta: { filterOptions: [...new Set(documents.map((document) => typeLabels[document.type]))] },
        }),
        columnHelper.accessor("createdAt", {
          header: "Date",
          cell: (info) => formatDate(info.getValue()),
          meta: {
            filterOptions: [...new Set(documents.map((document) => document.createdAt.getFullYear().toString()))],
          },
          filterFn: (row, _, filterValue) =>
            Array.isArray(filterValue) && filterValue.includes(row.original.createdAt.getFullYear().toString()),
        }),
        columnHelper.accessor((row) => getStatus(row).name, {
          header: "Status",
          meta: { filterOptions: [...new Set(documents.map((document) => getStatus(document).name))] },
          cell: (info) => {
            const { variant, text } = getStatus(info.row.original);
            return <Status variant={variant}>{text}</Status>;
          },
        }),
        columnHelper.display({
          id: "actions",
          cell: (info) => {
            const document = info.row.original;
            return (
              <>
                {isSignable(document) ? (
                  <Button
                    variant="outline"
                    size="small"
                    onClick={() => setSignDocumentId(document.id)}
                    disabled={!canSign}
                  >
                    Review and sign
                  </Button>
                ) : null}
                {document.attachment ? (
                  <Button variant="outline" size="small" asChild>
                    <Link href={`/download/${document.attachment.key}/${document.attachment.filename}`} download>
                      <Download className="size-4" />
                      Download
                    </Link>
                  </Button>
                ) : document.docusealSubmissionId && document.signatories.every((signatory) => signatory.signedAt) ? (
                  <Button variant="outline" size="small" onClick={() => setDownloadDocument(document.id)}>
                    <Download className="size-4" />
                    Download
                  </Button>
                ) : null}
              </>
            );
          },
        }),
      ].filter((column) => !!column),
    [userId],
  );
  const storedColumnFilters = columnFiltersSchema.safeParse(
    JSON.parse(localStorage.getItem(storageKeys.DOCUMENTS_COLUMN_FILTERS) ?? "{}"),
  );
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>(
    storedColumnFilters.data ?? [{ id: "Status", value: ["Signature required"] }],
  );
  const table = useTable({
    columns,
    data: documents,
    initialState: { sorting: [{ id: "createdAt", desc: true }] },
    state: { columnFilters },
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    onColumnFiltersChange: (columnFilters) =>
      setColumnFilters((old) => {
        const value = typeof columnFilters === "function" ? columnFilters(old) : columnFilters;
        localStorage.setItem(storageKeys.DOCUMENTS_COLUMN_FILTERS, JSON.stringify(value));
        return value;
      }),
  });

  const filingDueDateFor1099DIV = new Date(currentYear, 2, 31);

  return (
    <>
      <DashboardHeader
        title="Documents"
        headerActions={
          <>
            {isCompanyRepresentative && documents.length === 0 ? <EditTemplates /> : null}
            {user.roles.administrator ? (
              <Link
                className={linkClasses}
                href={{ pathname: "/settings/administrator/roles", query: { addMember: true } }}
              >
                <BriefcaseBusiness className="size-4" />
                Invite lawyer
              </Link>
            ) : null}
          </>
        }
      />

      {!canSign || (user.roles.administrator && new Date() <= filingDueDateFor1099DIV) ? (
        <div className="grid gap-4">
          {!canSign && (
            <Alert className="mx-4">
              <Info className="size-4" />
              <AlertDescription>
                Please{" "}
                <Link className={linkClasses} href="/settings/tax">
                  provide your legal details
                </Link>{" "}
                before signing documents.
              </AlertDescription>
            </Alert>
          )}
          {user.roles.administrator && new Date() <= filingDueDateFor1099DIV ? (
            <Alert className="mx-4">
              <AlertTitle>Upcoming filing dates for 1099-NEC, 1099-DIV, and 1042-S</AlertTitle>
              <AlertDescription>
                We will submit form 1099-NEC to the IRS on {formatDate(new Date(currentYear, 0, 31))}, form 1042-S on{" "}
                {formatDate(new Date(currentYear, 2, 15))}, and form 1099-DIV on {formatDate(filingDueDateFor1099DIV)}.
              </AlertDescription>
            </Alert>
          ) : null}
        </div>
      ) : null}

      {isLoading ? (
        <TableSkeleton columns={6} />
      ) : documents.length > 0 ? (
        <>
          <DataTable
            table={table}
            actions={isCompanyRepresentative ? <EditTemplates /> : undefined}
            {...(isCompanyRepresentative && { searchColumn: "Signer" })}
          />
          {signDocument ? <SignDocumentModal document={signDocument} onClose={() => setSignDocumentId(null)} /> : null}
        </>
      ) : (
        <div className="mx-4">
          <Placeholder icon={CircleCheck}>No documents yet.</Placeholder>
        </div>
      )}
      {forceWorkerOnboarding ? <FinishOnboarding handleComplete={() => setForceWorkerOnboarding(false)} /> : null}
    </>
  );
}

const SignDocumentModal = ({ document, onClose }: { document: SignableDocument; onClose: () => void }) => {
  const user = useCurrentUser();
  const company = useCurrentCompany();
  const [redirectUrl] = useQueryState("next");
  const router = useRouter();
  const [{ slug, readonlyFields }] = trpc.documents.templates.getSubmitterSlug.useSuspenseQuery({
    id: document.docusealSubmissionId,
    companyId: company.id,
  });
  const trpcUtils = trpc.useUtils();
  const queryClient = useQueryClient();

  const signDocument = trpc.documents.sign.useMutation({
    onSuccess: async () => {
      router.replace("/documents");
      await trpcUtils.documents.list.refetch();
      await queryClient.invalidateQueries({ queryKey: ["currentUser"] });
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- not ideal, but there's no good way to assert this right now
      if (redirectUrl) router.push(redirectUrl as Route);
      else onClose();
    },
  });

  return (
    <Dialog open onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-4xl">
        <DocusealForm
          src={`https://docuseal.com/s/${slug}`}
          readonlyFields={readonlyFields}
          customCss={customCss}
          onComplete={() => {
            signDocument.mutate({
              companyId: company.id,
              id: document.id,
              role:
                document.signatories.find((signatory) => signatory.id === user.id)?.title ?? "Company Representative",
            });
          }}
        />
      </DialogContent>
    </Dialog>
  );
};
