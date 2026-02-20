import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { SidebarProvider, SidebarInset, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { Separator } from "@/components/ui/separator";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { AuthButton } from "@/components/auth-button";
import { ensureOrganization } from "./actions";

async function OrgGuard({ children }: { children: React.ReactNode }) {
  await ensureOrganization();
  return <>{children}</>;
}

async function SidebarData() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return <AppSidebar userData={null} orgs={[]} currentOrgId={null} />;
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("current_organization_id")
    .eq("id", user.id)
    .single();

  const { data: memberships } = await supabase
    .from("organization_members")
    .select("organization_id, role, organizations(id, name, is_demo)")
    .eq("user_id", user.id);

  const orgs = (memberships ?? []).map((m) => {
    const org = m.organizations as unknown as {
      id: string;
      name: string;
      is_demo: boolean;
    };
    return {
      id: org.id,
      name: org.name,
      isDemo: org.is_demo,
      role: m.role as string,
    };
  });

  return (
    <AppSidebar
      userData={{
        name: user.user_metadata?.full_name || user.email?.split("@")[0] || "User",
        email: user.email ?? "",
        avatar: user.user_metadata?.avatar_url || "",
      }}
      orgs={orgs}
      currentOrgId={profile?.current_organization_id ?? null}
    />
  );
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SidebarProvider>
      <Suspense>
        <SidebarData />
      </Suspense>
      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
          <div className="flex items-center gap-2 px-4">
            <SidebarTrigger className="-ml-1" />
            <Separator
              orientation="vertical"
              className="mr-2 data-[orientation=vertical]:h-4"
            />
          </div>
          <div className="ml-auto flex items-center gap-4 px-4">
            <ThemeSwitcher />
            <Suspense>
              <AuthButton />
            </Suspense>
          </div>
        </header>
        <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
          <Suspense>
            <OrgGuard>{children}</OrgGuard>
          </Suspense>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
