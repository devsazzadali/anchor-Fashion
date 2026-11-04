export interface GalleryImageItem {
  id?: string;
  url: string;
  alt_text?: string;
  is_primary?: boolean;
  media_type?: "IMAGE" | "VIDEO" | "360_VIEW" | string;
}

export type GalleryImageInput = string | GalleryImageItem;

export interface ProductGalleryProps {
  images: GalleryImageInput[];
  productName?: string;
  discountPercent?: number | null;
  className?: string;
  initialViewMode?: "carousel" | "grid";
}

/** A gallery image after normalization inside ProductGallery. */
export interface NormalizedGalleryImage {
  url: string;
  alt: string;
  isVideo: boolean;
}
