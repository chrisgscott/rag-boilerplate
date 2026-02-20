"use client";

import { Button } from "@/components/ui/button";
import { History, SquarePen } from "lucide-react";

export function ChatHeader({
  title,
  onHistoryClick,
  onNewChat,
}: {
  title: string;
  onHistoryClick: () => void;
  onNewChat: () => void;
}) {
  return (
    <div className="flex h-10 shrink-0 items-center justify-between px-4">
      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onHistoryClick}>
        <History className="h-4 w-4" />
        <span className="sr-only">History</span>
      </Button>
      <h2 className="text-sm font-medium text-muted-foreground truncate max-w-[60%]">
        {title}
      </h2>
      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onNewChat}>
        <SquarePen className="h-4 w-4" />
        <span className="sr-only">New Chat</span>
      </Button>
    </div>
  );
}
