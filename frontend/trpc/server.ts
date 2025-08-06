import { createHydrationHelpers } from "@trpc/react-query/rsc";
import { cache } from "react";
import { capTableRouter } from "@/trpc/routes/capTable";
import { companiesRouter } from "@/trpc/routes/companies";
import { equityCalculationsRouter } from "@/trpc/routes/equityCalculations";
import { filesRouter } from "@/trpc/routes/files";
import { investorEntitiesRouter } from "@/trpc/routes/investorEntities";
import { companyInviteLinksRouter } from "./routes/companyInviteLinks";
import { companyUpdatesRouter } from "./routes/companyUpdates";
import { consolidatedInvoicesRouter } from "./routes/consolidatedInvoices";
import { contractorsRouter } from "./routes/contractors";
import { convertibleSecuritiesRouter } from "./routes/convertibleSecurities";
import { dividendRoundsRouter } from "./routes/dividendRounds";
import { dividendsRouter } from "./routes/dividends";
import { documentsRouter } from "./routes/documents";
import { equityGrantExercisesRouter } from "./routes/equityGrantExercises";
import { equityGrantsRouter } from "./routes/equityGrants";
import { expenseCategoriesRouter } from "./routes/expenseCategories";
import { investorsRouter } from "./routes/investors";
import { invoicesRouter } from "./routes/invoices";
import { optionPoolsRouter } from "./routes/optionPools";
import { quickbooksRouter } from "./routes/quickbooks";
import { shareHoldingsRouter } from "./routes/shareHoldings";
import { supportRouter } from "./routes/support";
import { tenderOffersRouter } from "./routes/tenderOffers";
import { usersRouter } from "./routes/users";
import { createClient } from "./shared";
import { createCallerFactory, createRouter } from "./";

export const appRouter = createRouter({
  users: usersRouter,
  contractors: contractorsRouter,
  quickbooks: quickbooksRouter,
  invoices: invoicesRouter,
  consolidatedInvoices: consolidatedInvoicesRouter,
  documents: documentsRouter,
  equityGrants: equityGrantsRouter,
  shareHoldings: shareHoldingsRouter,
  investors: investorsRouter,
  convertibleSecurities: convertibleSecuritiesRouter,
  dividends: dividendsRouter,
  dividendRounds: dividendRoundsRouter,
  equityGrantExercises: equityGrantExercisesRouter,
  tenderOffers: tenderOffersRouter,

  optionPools: optionPoolsRouter,
  companyUpdates: companyUpdatesRouter,
  capTable: capTableRouter,

  companies: companiesRouter,
  files: filesRouter,
  expenseCategories: expenseCategoriesRouter,
  investorEntities: investorEntitiesRouter,
  equityCalculations: equityCalculationsRouter,
  companyInviteLinks: companyInviteLinksRouter,
  support: supportRouter,
});
export type AppRouter = typeof appRouter;

export const getQueryClient = cache(createClient);
const createCaller = createCallerFactory(appRouter);
const caller = createCaller({ userId: null, host: "", ipAddress: "", userAgent: "", headers: {} });
export const { trpc, HydrateClient } = createHydrationHelpers<typeof appRouter>(caller, getQueryClient);
export const createServerCaller = ({ userId }: { userId: number }) =>
  createCaller({ userId, host: "", ipAddress: "", userAgent: "", headers: {} });
