"use client";

import React from "react";
import Image from "next/image";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  RotateCcw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { NormalizedGalleryImage } from "./ProductGallery.types";

export interface ProductGalleryLightboxProps {
  isLightboxOpen: boolean;
  normalizedImages: NormalizedGalleryImage[];
  productName: string;
  hasMultiple: boolean;
  lightboxIndex: number;
  setLightboxIndex: React.Dispatch<React.SetStateAction<number>>;
  lightboxZoom: number;
  setLightboxZoom: React.Dispatch<React.SetStateAction<number>>;
  panPosition: { x: number; y: number };
  setPanPosition: React.Dispatch<
    React.SetStateAction<{ x: number; y: number }>
  >;
  isDragging: boolean;
  closeLightbox: () => void;
  handleLightboxPrev: (e?: React.MouseEvent) => void;
  handleLightboxNext: (e?: React.MouseEvent) => void;
  handleZoomIn: (e?: React.MouseEvent) => void;
  handleZoomOut: (e?: React.MouseEvent) => void;
  handleResetZoom: (e?: React.MouseEvent) => void;
  handleToggleZoom: (e: React.MouseEvent) => void;
  handleMouseDown: (e: React.MouseEvent) => void;
  handleMouseDrag: (e: React.MouseEvent) => void;
  handleMouseUp: () => void;
}

export function ProductGalleryLightbox({
  isLightboxOpen,
  normalizedImages,
  productName,
  hasMultiple,
  lightboxIndex,
  setLightboxIndex,
  lightboxZoom,
  setLightboxZoom,
  panPosition,
  setPanPosition,
  isDragging,
  closeLightbox,
  handleLightboxPrev,
  handleLightboxNext,
  handleZoomIn,
  handleZoomOut,
  handleResetZoom,
  handleToggleZoom,
  handleMouseDown,
  handleMouseDrag,
  handleMouseUp,
}: ProductGalleryLightboxProps) {
  return (
    <>
      {/* ======================================================== */}
      {/* CINEMATIC FULLSCREEN LIGHTBOX & PAN-ZOOM MODAL */}
      {/* ======================================================== */}
      <AnimatePresence>
        {isLightboxOpen && (
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="High resolution image gallery modal"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[120] flex flex-col justify-between bg-black/95 text-white backdrop-blur-2xl p-4 sm:p-6 select-none"
            onClick={closeLightbox}
          >
            {/* Lightbox Top Header Toolbar */}
            <div
              className="relative z-30 flex items-center justify-between border-b border-white/10 pb-4"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Product Info & Image Counter */}
              <div className="flex items-center gap-3">
                <span className="text-xs font-semibold uppercase tracking-[0.25em] text-[#C9A86A]">
                  Anchor Fashion
                </span>
                <span className="text-white/30">•</span>
                <span className="text-xs text-white/80 truncate max-w-[180px] sm:max-w-xs">
                  {productName}
                </span>
                <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-[11px] font-mono text-white/90">
                  {lightboxIndex + 1} of {normalizedImages.length}
                </span>
              </div>

              {/* Zoom & Action Controls */}
              <div className="flex items-center gap-1.5 sm:gap-2">
                <button
                  type="button"
                  onClick={handleZoomOut}
                  disabled={lightboxZoom <= 1}
                  aria-label="Zoom out"
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white/90 transition-all hover:bg-white/20 disabled:opacity-30 disabled:hover:bg-white/10"
                >
                  <ZoomOut className="h-4 w-4" />
                </button>

                <button
                  type="button"
                  onClick={handleResetZoom}
                  title="Reset zoom"
                  className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-mono text-white/90 transition-all hover:bg-white/20"
                >
                  {Math.round(lightboxZoom * 100)}%
                </button>

                <button
                  type="button"
                  onClick={handleZoomIn}
                  disabled={lightboxZoom >= 3}
                  aria-label="Zoom in"
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white/90 transition-all hover:bg-white/20 disabled:opacity-30 disabled:hover:bg-white/10"
                >
                  <ZoomIn className="h-4 w-4" />
                </button>

                {lightboxZoom > 1 && (
                  <button
                    type="button"
                    onClick={handleResetZoom}
                    title="Reset pan & zoom"
                    className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white/90 transition-all hover:bg-white/20"
                  >
                    <RotateCcw className="h-4 w-4" />
                  </button>
                )}

                <div className="h-5 w-[1px] bg-white/20 mx-1" />

                <button
                  type="button"
                  onClick={closeLightbox}
                  aria-label="Close full screen view"
                  className="flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-white transition-all hover:bg-white hover:text-black hover:rotate-90"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            {/* Lightbox Center Stage (Draggable when zoomed) */}
            <div
              className="relative flex-1 flex items-center justify-center overflow-hidden my-4"
              onClick={(e) => e.stopPropagation()}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseDrag}
              onMouseUp={handleMouseUp}
              style={{
                cursor:
                  lightboxZoom > 1
                    ? isDragging
                      ? "grabbing"
                      : "grab"
                    : "zoom-in",
              }}
            >
              <div
                className="relative h-[80vh] w-full max-w-5xl transition-transform duration-150 ease-out"
                style={{
                  transform: `scale(${lightboxZoom}) translate(${panPosition.x / lightboxZoom}px, ${panPosition.y / lightboxZoom}px)`,
                }}
                onDoubleClick={handleToggleZoom}
              >
                {normalizedImages[lightboxIndex]?.isVideo ? (
                  <video
                    src={normalizedImages[lightboxIndex].url}
                    controls
                    autoPlay
                    loop
                    className="h-full w-full object-contain"
                  />
                ) : (
                  <Image
                    src={
                      normalizedImages[lightboxIndex]?.url ||
                      normalizedImages[0]?.url
                    }
                    alt={
                      normalizedImages[lightboxIndex]?.alt ||
                      "Full resolution product image"
                    }
                    fill
                    priority
                    sizes="100vw"
                    className="object-contain"
                    draggable={false}
                  />
                )}
              </div>

              {/* Left / Right Navigation chevrons in Lightbox */}
              {hasMultiple && (
                <>
                  <button
                    type="button"
                    onClick={handleLightboxPrev}
                    aria-label="Previous image"
                    className="absolute left-2 sm:left-6 top-1/2 -translate-y-1/2 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-white/10 text-white shadow-xl backdrop-blur-md transition-all hover:bg-white hover:text-black hover:scale-110 active:scale-95 border border-white/15"
                  >
                    <ChevronLeft className="h-6 w-6" />
                  </button>
                  <button
                    type="button"
                    onClick={handleLightboxNext}
                    aria-label="Next image"
                    className="absolute right-2 sm:right-6 top-1/2 -translate-y-1/2 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-white/10 text-white shadow-xl backdrop-blur-md transition-all hover:bg-white hover:text-black hover:scale-110 active:scale-95 border border-white/15"
                  >
                    <ChevronRight className="h-6 w-6" />
                  </button>
                </>
              )}
            </div>

            {/* Lightbox Bottom Filmstrip & Shortcuts Hint */}
            <div
              className="relative z-30 flex flex-col items-center gap-3 border-t border-white/10 pt-3"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Keyboard Shortcuts Hint */}
              <p className="text-[11px] text-white/50 tracking-wide hidden sm:block">
                Press <kbd className="rounded bg-white/15 px-1 py-0.5 font-mono text-[10px]">ESC</kbd> to close •{" "}
                <kbd className="rounded bg-white/15 px-1 py-0.5 font-mono text-[10px]">←</kbd>{" "}
                <kbd className="rounded bg-white/15 px-1 py-0.5 font-mono text-[10px]">→</kbd> to navigate • Double-click or <kbd className="rounded bg-white/15 px-1 py-0.5 font-mono text-[10px]">+</kbd> <kbd className="rounded bg-white/15 px-1 py-0.5 font-mono text-[10px]">-</kbd> to zoom
              </p>

              {/* Bottom Filmstrip Thumbnails */}
              {hasMultiple && (
                <div
                  className="flex items-center gap-2 max-w-full overflow-x-auto py-1 px-2 scrollbar-none"
                  style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
                >
                  {normalizedImages.map((img, idx) => {
                    const isActive = idx === lightboxIndex;
                    return (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => {
                          setLightboxIndex(idx);
                          setLightboxZoom(1);
                          setPanPosition({ x: 0, y: 0 });
                        }}
                        className={cn(
                          "relative aspect-[3/4] h-14 sm:h-16 shrink-0 overflow-hidden rounded-xl border-2 transition-all duration-200",
                          isActive
                            ? "border-[#C9A86A] ring-2 ring-[#C9A86A]/50 scale-105"
                            : "border-transparent opacity-40 hover:opacity-100"
                        )}
                      >
                        <Image
                          src={img.url}
                          alt={img.alt}
                          fill
                          sizes="64px"
                          className="object-cover object-center"
                        />
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
