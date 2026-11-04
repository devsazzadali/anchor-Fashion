"use client";

import React from "react";
import Image from "next/image";
import {
  Maximize2,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  ZoomIn,
  Play,
  Columns2,
  LayoutGrid,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { NormalizedGalleryImage } from "./ProductGallery.types";

export interface ProductGalleryDesktopProps {
  normalizedImages: NormalizedGalleryImage[];
  viewMode: "carousel" | "grid";
  setViewMode: React.Dispatch<React.SetStateAction<"carousel" | "grid">>;
  currentIndex: number;
  setCurrentIndex: React.Dispatch<React.SetStateAction<number>>;
  setImageLoaded: React.Dispatch<React.SetStateAction<boolean>>;
  activeImage: NormalizedGalleryImage;
  hasMultiple: boolean;
  discountPercent?: number | null;
  imageLoaded: boolean;
  isHovering: boolean;
  setIsHovering: React.Dispatch<React.SetStateAction<boolean>>;
  mousePos: { x: number; y: number };
  handleMouseMove: (e: React.MouseEvent<HTMLDivElement>) => void;
  thumbnailContainerRef: React.RefObject<HTMLDivElement | null>;
  thumbnailRefs: React.RefObject<(HTMLButtonElement | null)[]>;
  mainImageRef: React.RefObject<HTMLDivElement | null>;
  scrollThumbnails: (direction: "up" | "down") => void;
  openLightbox: (index: number) => void;
  goToPrev: (e?: React.MouseEvent) => void;
  goToNext: (e?: React.MouseEvent) => void;
}

export function ProductGalleryDesktop({
  normalizedImages,
  viewMode,
  setViewMode,
  currentIndex,
  setCurrentIndex,
  setImageLoaded,
  activeImage,
  hasMultiple,
  discountPercent,
  imageLoaded,
  isHovering,
  setIsHovering,
  mousePos,
  handleMouseMove,
  thumbnailContainerRef,
  thumbnailRefs,
  mainImageRef,
  scrollThumbnails,
  openLightbox,
  goToPrev,
  goToNext,
}: ProductGalleryDesktopProps) {
  return (
    <>
      {/* ======================================================== */}
      {/* DESKTOP VIEW (>= lg: 1024px) */}
      {/* ======================================================== */}
      <div className="hidden lg:block">
        {/* Gallery Mode Toggle Toolbar */}
        {hasMultiple && (
          <div className="mb-3 flex items-center justify-between px-1">
            <span className="text-[10px] font-semibold uppercase tracking-[0.25em] text-zinc-400">
              {viewMode === "grid" ? "Editorial Lookbook" : "Product Gallery"}
            </span>

            <div className="flex items-center gap-1 rounded-lg border border-zinc-200/70 bg-zinc-50/80 p-0.5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/80">
              <button
                type="button"
                onClick={() => setViewMode("carousel")}
                title="Single view with zoom"
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium transition-all",
                  viewMode === "carousel"
                    ? "bg-white text-zinc-950 shadow-sm dark:bg-zinc-800 dark:text-white"
                    : "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200"
                )}
              >
                <Columns2 className="h-3.5 w-3.5" />
                <span>Slider</span>
              </button>

              <button
                type="button"
                onClick={() => setViewMode("grid")}
                title="Editorial 2-column grid"
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium transition-all",
                  viewMode === "grid"
                    ? "bg-white text-zinc-950 shadow-sm dark:bg-zinc-800 dark:text-white"
                    : "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200"
                )}
              >
                <LayoutGrid className="h-3.5 w-3.5" />
                <span>Grid</span>
              </button>
            </div>
          </div>
        )}

        {/* MODE A: CAROUSEL WITH THUMBNAILS & SILKY HOVER ZOOM */}
        {viewMode === "carousel" && (
          <div className="flex flex-row items-start gap-4">
            {/* Left Side: Vertical Thumbnail Track */}
            {hasMultiple && (
              <div className="relative flex flex-col items-center shrink-0 w-[78px] xl:w-[86px]">
                {/* Scroll Up Button (shown if > 4 images) */}
                {normalizedImages.length > 4 && (
                  <button
                    type="button"
                    onClick={() => scrollThumbnails("up")}
                    aria-label="Scroll thumbnails up"
                    className="mb-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-white/95 text-zinc-600 shadow-sm transition-all hover:bg-black hover:text-white dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-white dark:hover:text-black border border-zinc-200/80 dark:border-zinc-700"
                  >
                    <ChevronUp className="h-4 w-4" />
                  </button>
                )}

                {/* Scrollable Thumbnails List */}
                <div
                  ref={thumbnailContainerRef}
                  className="flex flex-col gap-2.5 max-h-[580px] xl:max-h-[640px] overflow-y-auto overflow-x-hidden py-1 px-0.5 scrollbar-none scroll-smooth"
                  style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
                >
                  {normalizedImages.map((img, idx) => {
                    const isActive = idx === currentIndex;
                    return (
                      <button
                        key={idx}
                        ref={(el) => {
                          thumbnailRefs.current[idx] = el;
                        }}
                        type="button"
                        onClick={() => {
                          setCurrentIndex(idx);
                          setImageLoaded(false);
                        }}
                        onMouseEnter={() => {
                          setCurrentIndex(idx);
                        }}
                        aria-label={`View image ${idx + 1}`}
                        className={cn(
                          "group relative aspect-[3/4] w-[74px] xl:w-[82px] overflow-hidden rounded-xl border-2 transition-all duration-300",
                          isActive
                            ? "border-[#1A1A1A] ring-2 ring-[#C9A86A]/40 shadow-md scale-[1.03] dark:border-white"
                            : "border-transparent bg-zinc-100 opacity-60 hover:opacity-100 hover:border-zinc-300 dark:bg-zinc-800 dark:hover:border-zinc-700"
                        )}
                      >
                        <Image
                          src={img.url}
                          alt={img.alt}
                          fill
                          sizes="90px"
                          className="object-cover object-center transition-transform duration-500 group-hover:scale-105"
                        />
                        {/* Micro video badge if item is a video */}
                        {img.isVideo && (
                          <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                            <Play className="h-4 w-4 fill-white text-white drop-shadow" />
                          </div>
                        )}
                        {/* Gold accent active indicator */}
                        {isActive && (
                          <span className="absolute bottom-1 right-1 h-1.5 w-1.5 rounded-full bg-[#C9A86A]" />
                        )}
                      </button>
                    );
                  })}
                </div>

                {/* Scroll Down Button (shown if > 4 images) */}
                {normalizedImages.length > 4 && (
                  <button
                    type="button"
                    onClick={() => scrollThumbnails("down")}
                    aria-label="Scroll thumbnails down"
                    className="mt-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-white/95 text-zinc-600 shadow-sm transition-all hover:bg-black hover:text-white dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-white dark:hover:text-black border border-zinc-200/80 dark:border-zinc-700"
                  >
                    <ChevronDown className="h-4 w-4" />
                  </button>
                )}
              </div>
            )}

            {/* Right Side: Main Stage View with Interactive Hover Zoom */}
            <div
              ref={mainImageRef}
              onMouseEnter={() => setIsHovering(true)}
              onMouseLeave={() => setIsHovering(false)}
              onMouseMove={handleMouseMove}
              className="group relative flex-1 aspect-[3/4] overflow-hidden rounded-2xl border border-zinc-200/80 bg-[#FAFAFA] dark:border-zinc-800 dark:bg-zinc-900 cursor-crosshair shadow-sm"
            >
              {/* Main Stage Image with Smooth Zoom on Hover */}
              <div
                className="relative h-full w-full overflow-hidden"
                onClick={() => openLightbox(currentIndex)}
              >
                {/* Loading Shimmer Placeholder — rendered UNDER the image:
                    the image paints over it as soon as it decodes. (It used
                    to sit above an opacity-gated image; if the img load
                    event was missed before hydration, the gate never opened
                    and the stage stayed blank.) */}
                {!imageLoaded && !activeImage.isVideo && (
                  <div className="absolute inset-0 animate-pulse bg-gradient-to-r from-zinc-100 via-zinc-200/70 to-zinc-100 dark:from-zinc-800 dark:via-zinc-700 dark:to-zinc-800" />
                )}

                {activeImage.isVideo ? (
                  <video
                    src={activeImage.url}
                    controls
                    autoPlay
                    loop
                    muted
                    playsInline
                    className="h-full w-full object-cover object-center"
                  />
                ) : (
                  <Image
                    src={activeImage.url}
                    alt={activeImage.alt}
                    fill
                    priority
                    sizes="(max-width: 1280px) 50vw, 55vw"
                    onLoad={() => setImageLoaded(true)}
                    onError={() => setImageLoaded(true)}
                    className="object-cover object-center will-change-transform"
                    style={{
                      transform: isHovering ? "scale(2.3)" : "scale(1)",
                      transformOrigin: `${mousePos.x}% ${mousePos.y}%`,
                      transition: isHovering
                        ? "transform 0.12s cubic-bezier(0.2, 0, 0.2, 1)"
                        : "transform 0.4s cubic-bezier(0.2, 0, 0.2, 1), opacity 0.3s ease",
                    }}
                  />
                )}
              </div>

              {/* Discount / Flash Badge (Top Left) */}
              {discountPercent && discountPercent > 0 && (
                <div className="absolute left-4 top-4 z-20 pointer-events-none flex items-center gap-1.5 rounded-full bg-[#111111]/90 px-3 py-1 shadow-lg backdrop-blur-md border border-white/10">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#E50000] animate-ping" />
                  <span className="text-[11px] font-bold uppercase tracking-wider text-white">
                    {discountPercent}% OFF
                  </span>
                </div>
              )}

              {/* Top Right Actions: Fullscreen Lightbox Button & Zoom Hint */}
              <div className="absolute right-4 top-4 z-20 flex items-center gap-2">
                {/* Zoom hint badge: subtle luxury indicator */}
                <div
                  className={cn(
                    "hidden xl:flex items-center gap-1.5 rounded-full bg-white/90 px-3 py-1 text-[11px] font-medium tracking-wide text-zinc-800 shadow-sm backdrop-blur-md transition-opacity duration-300 dark:bg-zinc-900/90 dark:text-zinc-200 pointer-events-none",
                    isHovering ? "opacity-0" : "opacity-90"
                  )}
                >
                  <ZoomIn className="h-3 w-3 text-[#C9A86A]" />
                  <span>Hover to zoom</span>
                </div>

                {/* Lightbox / Fullscreen trigger button */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    openLightbox(currentIndex);
                  }}
                  title="View full screen"
                  aria-label="Open full screen lightbox"
                  className="flex h-10 w-10 items-center justify-center rounded-full bg-white/90 text-zinc-900 shadow-sm backdrop-blur-md transition-all duration-300 hover:bg-[#1A1A1A] hover:text-white dark:bg-zinc-800/90 dark:text-white dark:hover:bg-white dark:hover:text-black border border-zinc-200/60 dark:border-zinc-700 hover:scale-105 active:scale-95"
                >
                  <Maximize2 className="h-4 w-4" />
                </button>
              </div>

              {/* Bottom Right: Clean Luxury Counter Badge */}
              {hasMultiple && (
                <div className="absolute bottom-4 right-4 z-20 pointer-events-none flex items-center gap-1 rounded-full bg-black/70 px-3 py-1 text-[11px] font-mono tracking-widest text-white shadow-md backdrop-blur-md">
                  <span>{String(currentIndex + 1).padStart(2, "0")}</span>
                  <span className="opacity-40">/</span>
                  <span className="opacity-70">
                    {String(normalizedImages.length).padStart(2, "0")}
                  </span>
                </div>
              )}

              {/* Bottom Left: Micro hint during active hover zoom */}
              {isHovering && !activeImage.isVideo && (
                <div className="absolute bottom-4 left-4 z-20 pointer-events-none flex items-center gap-2 rounded-full bg-black/75 px-3.5 py-1 text-[10px] font-medium tracking-wider text-white backdrop-blur-md animate-in fade-in duration-200">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#C9A86A]" />
                  <span>2.3x Fabric Detail • Click to expand</span>
                </div>
              )}

              {/* Prev / Next Chevrons on Main Stage */}
              {hasMultiple && (
                <>
                  <button
                    type="button"
                    onClick={goToPrev}
                    aria-label="Previous image"
                    className="absolute left-3 top-1/2 -translate-y-1/2 z-20 flex h-11 w-11 items-center justify-center rounded-full bg-white/90 text-zinc-800 shadow-lg backdrop-blur-md transition-all duration-200 hover:bg-black hover:text-white hover:scale-110 active:scale-95 dark:bg-zinc-900/90 dark:text-zinc-200 dark:hover:bg-white dark:hover:text-black opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </button>
                  <button
                    type="button"
                    onClick={goToNext}
                    aria-label="Next image"
                    className="absolute right-3 top-1/2 -translate-y-1/2 z-20 flex h-11 w-11 items-center justify-center rounded-full bg-white/90 text-zinc-800 shadow-lg backdrop-blur-md transition-all duration-200 hover:bg-black hover:text-white hover:scale-110 active:scale-95 dark:bg-zinc-900/90 dark:text-zinc-200 dark:hover:bg-white dark:hover:text-black opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                  >
                    <ChevronRight className="h-5 w-5" />
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {/* MODE B: 2-COLUMN EDITORIAL GRID FOR HIGH FASHION SCROLL */}
        {viewMode === "grid" && (
          <div className="grid grid-cols-2 gap-3.5">
            {normalizedImages.map((img, idx) => (
              <div
                key={idx}
                onClick={() => openLightbox(idx)}
                className="group relative aspect-[3/4] overflow-hidden rounded-2xl border border-zinc-200/80 bg-[#FAFAFA] dark:border-zinc-800 dark:bg-zinc-900 cursor-zoom-in shadow-sm transition-all duration-300 hover:shadow-md"
              >
                <Image
                  src={img.url}
                  alt={img.alt}
                  fill
                  sizes="40vw"
                  className="object-cover object-center transition-transform duration-700 ease-out group-hover:scale-105"
                />

                {/* Hover overlay hint */}
                <div className="absolute inset-0 bg-black/0 transition-colors group-hover:bg-black/10" />

                {/* Pill counter */}
                <div className="absolute bottom-3 right-3 rounded-full bg-black/60 px-2.5 py-0.5 text-[10px] font-mono text-white backdrop-blur-md opacity-80 group-hover:opacity-100">
                  {String(idx + 1).padStart(2, "0")}
                </div>

                {/* Expand icon on hover */}
                <div className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-zinc-900 shadow-sm backdrop-blur-md opacity-0 group-hover:opacity-100 transition-opacity">
                  <Maximize2 className="h-3.5 w-3.5" />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
