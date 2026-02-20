"use client";

import { useState } from "react";
import { ThumbsUp, ThumbsDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { submitFeedback } from "@/app/(dashboard)/chat/actions";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type Props = {
  messageId: number;
};

export function MessageFeedback({ messageId }: Props) {
  const [rating, setRating] = useState<1 | 5 | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleFeedback(value: 1 | 5) {
    if (submitting) return;
    setSubmitting(true);
    setRating(value);

    const result = await submitFeedback(messageId, value);
    setSubmitting(false);

    if (result.error) {
      toast.error(result.error);
      setRating(null);
    }
  }

  return (
    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
      <Button
        variant="ghost"
        size="icon"
        className={cn("h-7 w-7", rating === 5 && "text-green-600")}
        onClick={() => handleFeedback(5)}
        disabled={submitting}
      >
        <ThumbsUp className="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className={cn("h-7 w-7", rating === 1 && "text-red-600")}
        onClick={() => handleFeedback(1)}
        disabled={submitting}
      >
        <ThumbsDown className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
