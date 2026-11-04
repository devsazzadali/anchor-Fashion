"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ProductGalleryProps } from "./ProductGallery.types";
import { ProductGalleryDesktop } from "./ProductGallery.desktop";
import { ProductGalleryMobile } from "./ProductGallery.mobile";
import { ProductGalleryLightbox } from "./ProductGallery.lightbox";

export type {
  GalleryImageItem,
  GalleryImageInput,
  ProductGalleryProps,
} from "./ProductGallery.types";

export function ProductGallery({
  images,
  productName = "Product Image",
  discountPercent,
  className,
  initialViewMode = "carousel",
}: ProductGalleryProps) {
  // Normalize images to uniform array
  const normalizedImages = React.useMemo(() => {
    if (!images || images.length === 0) return [];
    return images
      .map((item, index) => {
        if (typeof item === "string") {
          const isVideo = item.endsWith(".mp4") || item.endsWith(".webm");
          return {
            url: item,
            alt: `${productName} — View ${index + 1}`,
            isVideo,
          };
        }
        if (item && typeof item === "object" && item.url) {
          const isVideo =
            item.media_type === "VIDEO" ||
            item.url.endsWith(".mp4") ||
            item.url.endsWith(".webm");
          return {
            url: item.url,
            alt: item.alt_text || `${productName} — View ${index + 1}`,
            isVideo,
          };
        }
        return null;
      })
      .filter((img): img is { url: string; alt: string; isVideo: boolean } =>
        Boolean(img?.url)
      );
  }, [images, productName]);

  const [currentIndex, setCurrentIndex] = useState(0);
  const [viewMode, setViewMode] = useState<"carousel" | "grid">(initialViewMode);
  const [isHovering, setIsHovering] = useState(false);
  const [mousePos, setMousePos] = useState({ x: 50, y: 50 });
  const [imageLoaded, setImageLoaded] = useState(false);

  // Lightbox state
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [lightboxZoom, setLightboxZoom] = useState(1);
  const [panPosition, setPanPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 });

  // Refs for auto-scrolling thumbnails & stage
  const thumbnailContainerRef = useRef<HTMLDivElement>(null);
  const thumbnailRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const mainImageRef = useRef<HTMLDivElement>(null);

  // Reset current index when the image SET actually changes (e.g.
  // variant switched). This used to key on the `images` array identity,
  // so any parent re-render that rebuilt the array — a variant-selector
  // emission, an RSC refresh — snapped the slider back to image 01
  // mid-interaction and thumbnail / Next clicks appeared to do nothing.
  // Compare the URL list instead: identity churn with the same images
  // no longer resets the position.
  const imagesKey = normalizedImages.map((img) => img.url).join("|");
  const prevImagesKeyRef = useRef(imagesKey);
  useEffect(() => {
    if (prevImagesKeyRef.current !== imagesKey) {
      prevImagesKeyRef.current = imagesKey;
      setCurrentIndex(0);
      setImageLoaded(false);
    }
  }, [imagesKey]);

  // Keep active thumbnail visible in vertical / horizontal strip
  useEffect(() => {
    const activeThumb = thumbnailRefs.current[currentIndex];
    if (activeThumb && thumbnailContainerRef.current) {
      activeThumb.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "nearest",
      });
    }
  }, [currentIndex]);

  const goToPrev = useCallback(
    (e?: React.MouseEvent) => {
      e?.stopPropagation();
      if (normalizedImages.length <= 1) return;
      setCurrentIndex((prev) =>
        prev > 0 ? prev - 1 : normalizedImages.length - 1
      );
      setImageLoaded(false);
    },
    [normalizedImages.length]
  );

  const goToNext = useCallback(
    (e?: React.MouseEvent) => {
      e?.stopPropagation();
      if (normalizedImages.length <= 1) return;
      setCurrentIndex((prev) =>
        prev < normalizedImages.length - 1 ? prev + 1 : 0
      );
      setImageLoaded(false);
    },
    [normalizedImages.length]
  );

  // Desktop Hover Zoom calculation
  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!mainImageRef.current) return;
    const rect = mainImageRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
    const y = Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100));
    setMousePos({ x, y });
  };

  // Lightbox handlers
  const openLightbox = (index: number) => {
    setLightboxIndex(index);
    setLightboxZoom(1);
    setPanPosition({ x: 0, y: 0 });
    setIsLightboxOpen(true);
  };

  const closeLightbox = () => {
    setIsLightboxOpen(false);
    setLightboxZoom(1);
    setPanPosition({ x: 0, y: 0 });
  };

  const handleLightboxPrev = useCallback(
    (e?: React.MouseEvent) => {
      e?.stopPropagation();
      if (normalizedImages.length <= 1) return;
      setLightboxIndex((prev) =>
        prev > 0 ? prev - 1 : normalizedImages.length - 1
      );
      setLightboxZoom(1);
      setPanPosition({ x: 0, y: 0 });
    },
    [normalizedImages.length]
  );

  const handleLightboxNext = useCallback(
    (e?: React.MouseEvent) => {
      e?.stopPropagation();
      if (normalizedImages.length <= 1) return;
      setLightboxIndex((prev) =>
        prev < normalizedImages.length - 1 ? prev + 1 : 0
      );
      setLightboxZoom(1);
      setPanPosition({ x: 0, y: 0 });
    },
    [normalizedImages.length]
  );

  const handleZoomIn = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    setLightboxZoom((prev) => Math.min(3, Math.round((prev + 0.5) * 10) / 10));
  };

  const handleZoomOut = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    setLightboxZoom((prev) => {
      const next = Math.max(1, Math.round((prev - 0.5) * 10) / 10);
      if (next === 1) setPanPosition({ x: 0, y: 0 });
      return next;
    });
  };

  const handleResetZoom = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    setLightboxZoom(1);
    setPanPosition({ x: 0, y: 0 });
  };

  const handleToggleZoom = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (lightboxZoom > 1) {
      setLightboxZoom(1);
      setPanPosition({ x: 0, y: 0 });
    } else {
      setLightboxZoom(2.2);
    }
  };

  // Lightbox Pan drag handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    if (lightboxZoom <= 1) return;
    e.preventDefault();
    setIsDragging(true);
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      panX: panPosition.x,
      panY: panPosition.y,
    };
  };

  const handleMouseDrag = (e: React.MouseEvent) => {
    if (!isDragging || lightboxZoom <= 1) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    setPanPosition({
      x: dragStartRef.current.panX + dx,
      y: dragStartRef.current.panY + dy,
    });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  // Keyboard controls for Lightbox
  useEffect(() => {
    if (!isLightboxOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeLightbox();
      if (e.key === "ArrowLeft") handleLightboxPrev();
      if (e.key === "ArrowRight") handleLightboxNext();
      if (e.key === "+" || e.key === "=") handleZoomIn();
      if (e.key === "-") handleZoomOut();
      if (e.key === "0") handleResetZoom();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isLightboxOpen, handleLightboxPrev, handleLightboxNext]);

  // Touch swipe support for mobile
  const touchStartXRef = useRef<number | null>(null);
  const touchStartYRef = useRef<number | null>(null);

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartXRef.current = e.touches[0].clientX;
    touchStartYRef.current = e.touches[0].clientY;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartXRef.current === null || touchStartYRef.current === null) return;
    const diffX = e.changedTouches[0].clientX - touchStartXRef.current;
    const diffY = e.changedTouches[0].clientY - touchStartYRef.current;

    // Register horizontal swipe if diffX is significantly larger than diffY
    if (Math.abs(diffX) > 40 && Math.abs(diffX) > Math.abs(diffY)) {
      if (diffX > 0) {
        goToPrev();
      } else {
        goToNext();
      }
    }
    touchStartXRef.current = null;
    touchStartYRef.current = null;
  };

  // Thumbnail strip scroll controls
  const scrollThumbnails = (direction: "up" | "down") => {
    if (!thumbnailContainerRef.current) return;
    const scrollAmount = direction === "up" ? -150 : 150;
    thumbnailContainerRef.current.scrollBy({
      top: scrollAmount,
      behavior: "smooth",
    });
  };

  if (normalizedImages.length === 0) {
    return (
      <div className="flex aspect-[3/4] w-full items-center justify-center rounded-2xl border border-zinc-200/80 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/50">
        <div className="text-center">
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-zinc-100 text-zinc-400 dark:bg-zinc-800">
            <Sparkles className="h-5 w-5" />
          </div>
          <p className="text-xs font-medium uppercase tracking-widest text-zinc-400">
            No Images Available
          </p>
        </div>
      </div>
    );
  }

  const activeImage = normalizedImages[currentIndex] || normalizedImages[0];
  const hasMultiple = normalizedImages.length > 1;

  // imageLoaded only drives the shimmer placeholder now. When the browser
  // finishes loading before React hydration attaches onLoad — routine for
  // fast local /uploads images — the event can be missed and the shimmer
  // would linger. Reconcile from the DOM state: if the rendered stage img
  // is already complete, mark it loaded.
  useEffect(() => {
    const img = mainImageRef.current?.querySelector("img");
    if (img && img.complete && img.naturalWidth > 0) {
      setImageLoaded(true);
    }
  }, [currentIndex, activeImage?.url]);

  return (
    <div className={cn("w-full select-none", className)}>
      <ProductGalleryDesktop
        normalizedImages={normalizedImages}
        viewMode={viewMode}
        setViewMode={setViewMode}
        currentIndex={currentIndex}
        setCurrentIndex={setCurrentIndex}
        setImageLoaded={setImageLoaded}
        activeImage={activeImage}
        hasMultiple={hasMultiple}
        discountPercent={discountPercent}
        imageLoaded={imageLoaded}
        isHovering={isHovering}
        setIsHovering={setIsHovering}
        mousePos={mousePos}
        handleMouseMove={handleMouseMove}
        thumbnailContainerRef={thumbnailContainerRef}
        thumbnailRefs={thumbnailRefs}
        mainImageRef={mainImageRef}
        scrollThumbnails={scrollThumbnails}
        openLightbox={openLightbox}
        goToPrev={goToPrev}
        goToNext={goToNext}
      />

      <ProductGalleryMobile
        normalizedImages={normalizedImages}
        currentIndex={currentIndex}
        setCurrentIndex={setCurrentIndex}
        activeImage={activeImage}
        hasMultiple={hasMultiple}
        discountPercent={discountPercent}
        handleTouchStart={handleTouchStart}
        handleTouchEnd={handleTouchEnd}
        openLightbox={openLightbox}
        goToPrev={goToPrev}
        goToNext={goToNext}
      />

      <ProductGalleryLightbox
        isLightboxOpen={isLightboxOpen}
        normalizedImages={normalizedImages}
        productName={productName}
        hasMultiple={hasMultiple}
        lightboxIndex={lightboxIndex}
        setLightboxIndex={setLightboxIndex}
        lightboxZoom={lightboxZoom}
        setLightboxZoom={setLightboxZoom}
        panPosition={panPosition}
        setPanPosition={setPanPosition}
        isDragging={isDragging}
        closeLightbox={closeLightbox}
        handleLightboxPrev={handleLightboxPrev}
        handleLightboxNext={handleLightboxNext}
        handleZoomIn={handleZoomIn}
        handleZoomOut={handleZoomOut}
        handleResetZoom={handleResetZoom}
        handleToggleZoom={handleToggleZoom}
        handleMouseDown={handleMouseDown}
        handleMouseDrag={handleMouseDrag}
        handleMouseUp={handleMouseUp}
      />
    </div>
  );
}
