"use client";

import { useState, useEffect } from "react";
import { BookIcon, ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogPortal,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { createClient as createBrowserSupabase } from "@/lib/supabase/client";

export type PageImageInfo = {
  pageNumber: string;
  storagePath: string;
  documentName?: string;
};

/** Hook to lazy-load a signed Storage URL for a page image path. */
export function useSignedUrl(storagePath: string | undefined) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    setUrl(null); // Reset stale URL when path changes
    if (!storagePath) return;
    let cancelled = false;
    const supabase = createBrowserSupabase();
    supabase.storage
      .from("documents")
      .createSignedUrl(storagePath, 3600)
      .then(({ data }) => {
        if (!cancelled && data) setUrl(data.signedUrl);
      });
    return () => {
      cancelled = true;
    };
  }, [storagePath]);

  return url;
}

/** Small thumbnail that lazy-loads a signed Storage URL for a page image. */
export function SourceThumbnail({ storagePath }: { storagePath: string }) {
  const url = useSignedUrl(storagePath);

  if (!url) return <BookIcon className="h-4 w-4 shrink-0" />;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt="Page preview"
      className="h-8 w-8 shrink-0 rounded object-cover"
    />
  );
}

/** A single clickable thumbnail card in the gallery. */
function PageImageCard({
  image,
  onClick,
}: {
  image: PageImageInfo;
  onClick: () => void;
}) {
  const url = useSignedUrl(image.storagePath);

  return (
    <button
      type="button"
      onClick={onClick}
      className="group/card flex-none w-24 rounded-lg border border-border bg-muted/50 overflow-hidden transition-colors hover:border-primary/50 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="relative w-full aspect-[4/3] bg-muted">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url}
            alt={`Page ${image.pageNumber}`}
            className="h-full w-full object-cover"
          />
        ) : (
          <Skeleton className="h-full w-full" />
        )}
      </div>
      <div className="px-1.5 py-1 text-[10px] text-muted-foreground truncate text-center">
        Page {image.pageNumber}
      </div>
    </button>
  );
}

/** Horizontal gallery of page image thumbnails with Dialog lightbox. */
export function PageImageGallery({ images }: { images: PageImageInfo[] }) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const selectedImage = selectedIndex !== null ? images[selectedIndex] : null;
  const selectedUrl = useSignedUrl(selectedImage?.storagePath);
  const [imageLoaded, setImageLoaded] = useState(false);

  // Reset loaded state when the selected image changes
  useEffect(() => {
    setImageLoaded(false);
  }, [selectedImage?.storagePath]);

  if (images.length === 0) return null;

  const hasPrev = selectedIndex !== null && selectedIndex > 0;
  const hasNext = selectedIndex !== null && selectedIndex < images.length - 1;

  return (
    <>
      <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
        {images.map((img, i) => (
          <PageImageCard
            key={`${img.storagePath}`}
            image={img}
            onClick={() => setSelectedIndex(i)}
          />
        ))}
      </div>

      <Dialog
        open={selectedIndex !== null}
        onOpenChange={(open) => !open && setSelectedIndex(null)}
      >
        <DialogContent className="sm:max-w-3xl p-0 gap-0 overflow-hidden">
          <DialogHeader className="p-4 pb-2">
            <DialogTitle className="text-sm font-medium">
              Page {selectedImage?.pageNumber}
              {selectedImage?.documentName && (
                <span className="ml-2 text-muted-foreground font-normal">
                  — {selectedImage.documentName}
                </span>
              )}
              {images.length > 1 && (
                <span className="ml-2 text-muted-foreground font-normal">
                  ({(selectedIndex ?? 0) + 1} of {images.length})
                </span>
              )}
            </DialogTitle>
          </DialogHeader>
          <div className="px-4 pb-4">
            {!imageLoaded && <Skeleton className="w-full h-80 rounded-md" />}
            {selectedUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={selectedUrl}
                alt={`Page ${selectedImage?.pageNumber}`}
                className={`w-full rounded-md ${imageLoaded ? "" : "hidden"}`}
                onLoad={() => setImageLoaded(true)}
              />
            )}
          </div>
        </DialogContent>
        {images.length > 1 && (
          <DialogPortal>
            <div className="fixed inset-0 z-[51] pointer-events-none flex items-center justify-center">
              <div className="w-full max-w-[calc(48rem+5rem)] flex items-center justify-between">
                <button
                  type="button"
                  disabled={!hasPrev}
                  onClick={() => hasPrev && setSelectedIndex(selectedIndex! - 1)}
                  className="pointer-events-auto rounded-full bg-background p-2 shadow-lg border border-border transition-opacity hover:bg-accent disabled:opacity-0 disabled:pointer-events-none"
                  aria-label="Previous image"
                >
                  <ChevronLeftIcon className="h-5 w-5" />
                </button>
                <button
                  type="button"
                  disabled={!hasNext}
                  onClick={() => hasNext && setSelectedIndex(selectedIndex! + 1)}
                  className="pointer-events-auto rounded-full bg-background p-2 shadow-lg border border-border transition-opacity hover:bg-accent disabled:opacity-0 disabled:pointer-events-none"
                  aria-label="Next image"
                >
                  <ChevronRightIcon className="h-5 w-5" />
                </button>
              </div>
            </div>
          </DialogPortal>
        )}
      </Dialog>
    </>
  );
}
