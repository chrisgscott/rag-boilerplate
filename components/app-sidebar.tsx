"use client"

import * as React from "react"
import {
  MessageSquare,
  FileText,
  FlaskConical,
  BarChart3,
  Settings,
  Building2,
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
]

// TODO: Replace with real org data from Supabase
const teams = [
  {
    name: "My Organization",
    logo: Building2,
    plan: "Pro",
  },
]

// TODO: Replace with real user data from auth session
const user = {
  name: "User",
  email: "",
  avatar: "",
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <TeamSwitcher teams={teams} />
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
