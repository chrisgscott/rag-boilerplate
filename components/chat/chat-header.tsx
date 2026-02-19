"use client";

import { Button } from "@/components/ui/button";
import { History, Plus } from "lucide-react";

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
    <div className="flex items-center justify-between border-b px-4 py-2">
      <Button variant="ghost" size="sm" onClick={onHistoryClick}>
        <History className="mr-1 h-4 w-4" />
        History
      </Button>
      <h2 className="text-sm font-medium truncate max-w-[50%]">{title}</h2>
      <Button variant="ghost" size="sm" onClick={onNewChat}>
        <Plus className="mr-1 h-4 w-4" />
        New Chat
      </Button>
    </div>
  );
}
