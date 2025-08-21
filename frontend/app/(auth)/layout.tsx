"use client";

import React, { Suspense } from "react";
import { UserDataProvider } from "@/trpc/client";

function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col bg-gray-50/50">
      <main className="flex flex-1 flex-col items-center overflow-y-auto px-3 py-3">
        <div className="mt-40 grid w-full max-w-md gap-4 print:my-0 print:max-w-full">{children}</div>
      </main>
    </div>
  );
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <UserDataProvider>
      <Suspense>
        <AuthLayout>{children}</AuthLayout>
      </Suspense>
    </UserDataProvider>
  );
}
