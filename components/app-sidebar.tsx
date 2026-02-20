"use client"

import * as React from "react"
import {
  MessageSquare,
  FileText,
  FlaskConical,
  BarChart3,
  Settings,
  ShieldCheck,
} from "lucide-react"

import { NavMain } from "@/components/nav-main"
import { NavUser } from "@/components/nav-user"
import { TeamSwitcher } from "@/components/team-switcher"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
  SidebarSeparator,
} from "@/components/ui/sidebar"

const appNav = [
  { title: "Chat", url: "/chat", icon: MessageSquare },
  { title: "Documents", url: "/documents", icon: FileText },
]

const adminNav = [
  { title: "Evaluation", url: "/eval", icon: FlaskConical },
  { title: "Usage", url: "/usage", icon: BarChart3 },
  { title: "Settings", url: "/settings", icon: Settings },
  { title: "Admin", url: "/admin", icon: ShieldCheck },
]

export type OrgData = {
  id: string
  name: string
  isDemo: boolean
  role: string
}

export function AppSidebar({
  userData,
  orgs,
  currentOrgId,
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  userData: { name: string; email: string; avatar: string } | null
  orgs: OrgData[]
  currentOrgId: string | null
}) {
  const user = userData ?? { name: "User", email: "", avatar: "" }

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <TeamSwitcher orgs={orgs} currentOrgId={currentOrgId} />
      </SidebarHeader>
      <SidebarContent>
        <NavMain label="App" items={appNav} />
        <SidebarSeparator />
        <NavMain label="Admin" items={adminNav} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={user} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
