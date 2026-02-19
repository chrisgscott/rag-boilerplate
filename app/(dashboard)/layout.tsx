import { Suspense } from "react";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { PageHeader } from "@/components/layout/page-header";
import { ensureOrganization } from "./actions";

async function OrgGuard({ children }: { children: React.ReactNode }) {
  await ensureOrganization();
  return <>{children}</>;
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <PageHeader />
        <main className="flex-1 p-6">
          <Suspense>
            <OrgGuard>{children}</OrgGuard>
          </Suspense>
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
