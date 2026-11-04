"use client";

import React from "react";
import Image from "next/image";
import { motion, AnimatePresence } from "framer-motion";
import { Maximize2, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { NormalizedGalleryImage } from "./ProductGallery.types";

export interface ProductGalleryMobileProps {
  normalizedImages: NormalizedGalleryImage[];
  currentIndex: number;
  setCurrentIndex: React.Dispatch<React.SetStateAction<number>>;
  activeImage: NormalizedGalleryImage;
  hasMultiple: boolean;
  discountPercent?: number | null;
  handleTouchStart: (e: React.TouchEvent) => void;
  handleTouchEnd: (e: React.TouchEvent) => void;
  openLightbox: (index: number) => void;
  goToPrev: (e?: React.MouseEvent) => void;
  goToNext: (e?: React.MouseEvent) => void;
}

export function ProductGalleryMobile({
  normalizedImages,
  currentIndex,
  setCurrentIndex,
  activeImage,
  hasMultiple,
  discountPercent,
  handleTouchStart,
  handleTouchEnd,
  openLightbox,
  goToPrev,
  goToNext,
}: ProductGalleryMobileProps) {
  return (
    <>
      {/* ======================================================== */}
      {/* MOBILE / TABLET VIEW (< lg: 1024px): Touch Swipe Carousel */}
      {/* ======================================================== */}
      <div className="flex flex-col gap-3 lg:hidden">
        {/* Main Swipeable Stage */}
        <div
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          onClick={() => openLightbox(currentIndex)}
          className="relative aspect-[3/4] w-full overflow-hidden rounded-2xl border border-zinc-200/80 bg-[#FAFAFA] dark:border-zinc-800 dark:bg-zinc-900 shadow-sm"
        >
          <AnimatePresence mode="wait">
            <motion.div
              key={currentIndex}
              initial={{ opacity: 0.6 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0.6 }}
              transition={{ duration: 0.2 }}
              className="relative h-full w-full"
            >
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
                  priority={currentIndex === 0}
                  sizes="100vw"
                  className="object-cover object-center"
                />
              )}
            </motion.div>
          </AnimatePresence>

          {/* Discount Badge Mobile */}
          {discountPercent && discountPercent > 0 && (
            <div className="absolute left-3 top-3 z-20 pointer-events-none flex items-center gap-1 rounded-full bg-[#111111]/90 px-2.5 py-1 shadow-md backdrop-blur-md border border-white/10">
              <span className="h-1.5 w-1.5 rounded-full bg-[#E50000] animate-ping" />
              <span className="text-[11px] font-bold uppercase tracking-wider text-white">
                {discountPercent}% OFF
              </span>
            </div>
          )}

          {/* Fullscreen Expand Button Mobile */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              openLightbox(currentIndex);
            }}
            aria-label="Open full screen"
            className="absolute right-3 top-3 z-20 flex h-9 w-9 items-center justify-center rounded-full bg-white/90 text-zinc-900 shadow-sm backdrop-blur-md transition-all active:scale-95 dark:bg-zinc-800/90 dark:text-white"
          >
            <Maximize2 className="h-4 w-4" />
          </button>

          {/* Chevrons on Mobile */}
          {hasMultiple && (
            <>
              <button
                type="button"
                onClick={goToPrev}
                aria-label="Previous image"
                className="absolute left-2 top-1/2 -translate-y-1/2 z-20 flex h-9 w-9 items-center justify-center rounded-full bg-white/80 text-zinc-900 shadow-sm backdrop-blur-md active:scale-90"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={goToNext}
                aria-label="Next image"
                className="absolute right-2 top-1/2 -translate-y-1/2 z-20 flex h-9 w-9 items-center justify-center rounded-full bg-white/80 text-zinc-900 shadow-sm backdrop-blur-md active:scale-90"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </>
          )}

          {/* Bottom Counter Pill for Mobile */}
          {hasMultiple && (
            <div className="absolute bottom-3 right-3 z-20 pointer-events-none rounded-full bg-black/70 px-2.5 py-1 text-[10px] font-mono tracking-widest text-white backdrop-blur-md">
              {currentIndex + 1} / {normalizedImages.length}
            </div>
          )}

          {/* Interactive Pagination Indicator Dots */}
          {hasMultiple && (
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1.5 pointer-events-none">
              {normalizedImages.map((_, dotIdx) => (
                <span
                  key={dotIdx}
                  className={cn(
                    "h-1.5 rounded-full transition-all duration-300",
                    dotIdx === currentIndex
                      ? "w-5 bg-[#C9A86A] shadow-sm"
                      : "w-1.5 bg-white/60"
                  )}
                />
              ))}
            </div>
          )}
        </div>

        {/* Mobile Horizontal Thumbnail Strip for Quick Jump */}
        {hasMultiple && (
          <div
            className="flex gap-2 overflow-x-auto py-1 px-1 scrollbar-none"
            style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
          >
            {normalizedImages.map((img, idx) => {
              const isActive = idx === currentIndex;
              return (
                <button
                  key={idx}
                  type="button"
                  onClick={() => setCurrentIndex(idx)}
                  className={cn(
                    "relative aspect-[3/4] h-16 shrink-0 overflow-hidden rounded-xl border-2 transition-all duration-200",
                    isActive
                      ? "border-[#1A1A1A] ring-2 ring-[#C9A86A]/40 scale-[1.03] dark:border-white"
                      : "border-transparent opacity-60 hover:opacity-100"
                  )}
                >
                  <Image
                    src={img.url}
                    alt={img.alt}
                    fill
                    sizes="64px"
                    className="object-cover object-center"
                  />
                  {isActive && (
                    <span className="absolute bottom-1 right-1 h-1.5 w-1.5 rounded-full bg-[#C9A86A]" />
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
