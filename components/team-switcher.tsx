"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { ChevronsUpDown, Building2 } from "lucide-react"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import type { OrgData } from "@/components/app-sidebar"

async function switchOrg(orgId: string) {
  const res = await fetch("/api/switch-org", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ organizationId: orgId }),
  });
  return res.ok;
}

export function TeamSwitcher({
  orgs,
  currentOrgId,
}: {
  orgs: OrgData[]
  currentOrgId: string | null
}) {
  const { isMobile } = useSidebar()
  const router = useRouter()
  const activeOrg = orgs.find((o) => o.id === currentOrgId) ?? orgs[0]

  if (!activeOrg) {
    return null
  }

  const handleSwitch = async (orgId: string) => {
    if (orgId === currentOrgId) return
    const ok = await switchOrg(orgId)
    if (ok) router.refresh()
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <div className="bg-sidebar-primary text-sidebar-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg">
                <span className="text-sm font-bold">{activeOrg.name.charAt(0).toUpperCase()}</span>
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{activeOrg.name}</span>
                <span className="truncate text-xs">{activeOrg.isDemo ? "Demo" : activeOrg.role}</span>
              </div>
              <ChevronsUpDown className="ml-auto" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            align="start"
            side={isMobile ? "bottom" : "right"}
            sideOffset={4}
          >
            <DropdownMenuLabel className="text-muted-foreground text-xs">
              Organizations
            </DropdownMenuLabel>
            {orgs.map((org) => (
              <DropdownMenuItem
                key={org.id}
                onClick={() => handleSwitch(org.id)}
                className="gap-2 p-2"
              >
                <div className="flex size-6 items-center justify-center rounded-md border">
                  <Building2 className="size-3.5 shrink-0" />
                </div>
                {org.name}
                {org.isDemo && (
                  <span className="ml-auto text-xs text-muted-foreground">Demo</span>
                )}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
