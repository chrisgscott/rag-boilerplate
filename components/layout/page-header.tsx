import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { AuthButton } from "@/components/auth-button";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { Suspense } from "react";

export function PageHeader({ title }: { title?: string }) {
  return (
    <header className="flex h-14 items-center gap-4 border-b px-4">
      <SidebarTrigger />
      <Separator orientation="vertical" className="h-6" />
      {title && <h1 className="text-lg font-semibold">{title}</h1>}
      <div className="ml-auto flex items-center gap-4">
        <ThemeSwitcher />
        <Suspense>
          <AuthButton />
        </Suspense>
      </div>
    </header>
  );
}
