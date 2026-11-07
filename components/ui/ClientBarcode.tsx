"use client";

import { Component, ReactNode, useEffect, useRef } from "react";
import Barcode from "react-barcode";

export interface ClientBarcodeProps {
  value: string;
  format?: string;
  width?: number;
  height?: number;
  displayValue?: boolean;
  font?: string;
  fontSize?: number;
  textAlign?: "left" | "center" | "right";
  textPosition?: "bottom" | "top";
  textMargin?: number;
  background?: string;
  lineColor?: string;
  margin?: number;
  marginTop?: number;
  marginBottom?: number;
  marginLeft?: number;
  marginRight?: number;
  flat?: boolean;
  renderer?: "svg" | "canvas" | "img";
  className?: string;
  /**
   * Fit the barcode to its container width (SVG renderer only). The rendered
   * SVG gets a viewBox matching its natural size and is then scaled with
   * width:100% / height:auto, preserving aspect ratio — so a wide barcode in
   * a narrow box (e.g. a 50mm thermal sticker) shrinks cleanly instead of
   * being clipped. Default false keeps the natural fixed-size rendering.
   */
  fit?: boolean;
}

interface ErrorBoundaryProps {
  children: ReactNode;
  fallbackValue: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

class BarcodeErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: any) {
    console.warn("ClientBarcode render warning, falling back:", error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="font-mono text-[9px] text-zinc-600 bg-zinc-50 border border-zinc-200 px-1 py-0.5 rounded text-center tracking-wider">
          {this.props.fallbackValue}
        </div>
      );
    }
    return this.props.children;
  }
}

export function ClientBarcode({
  value,
  format = "CODE128",
  renderer = "svg",
  width = 1.3,
  height = 32,
  displayValue = true,
  font = "monospace",
  fontSize = 10,
  textMargin = 2,
  background = "#ffffff",
  lineColor = "#000000",
  margin = 0,
  className,
  fit = false,
  ...rest
}: ClientBarcodeProps) {
  const safeValue = String(value || "000000000000").trim();

  // EAN13 format validation: if value contains non-digits or wrong length, safely fall back to CODE128
  const isEan13 = format === "EAN13";
  const isValidEan13 = isEan13 && /^\d{12,13}$/.test(safeValue);
  const effectiveFormat = isEan13 && !isValidEan13 ? "CODE128" : format;

  const wrapRef = useRef<HTMLDivElement>(null);

  // Fit mode: after JsBarcode renders its fixed-size SVG, give it a viewBox of
  // its natural size and let CSS scale it to the container (aspect preserved).
  useEffect(() => {
    if (!fit || renderer !== "svg") return;
    const svg = wrapRef.current?.querySelector("svg");
    if (!svg) return;
    const naturalWidth = parseFloat(svg.getAttribute("width") || "0");
    const naturalHeight = parseFloat(svg.getAttribute("height") || "0");
    if (naturalWidth > 0 && naturalHeight > 0 && !svg.getAttribute("viewBox")) {
      svg.setAttribute("viewBox", `0 0 ${naturalWidth} ${naturalHeight}`);
      svg.removeAttribute("width");
      svg.removeAttribute("height");
    }
    svg.style.width = "100%";
    svg.style.height = "auto";
    svg.style.display = "block";
    svg.style.maxWidth = "100%";
  }, [fit, renderer, safeValue, effectiveFormat, width, height, fontSize]);

  return (
    <BarcodeErrorBoundary fallbackValue={safeValue}>
      <div
        ref={wrapRef}
        className={className}
        style={{
          display: fit ? "block" : "inline-block",
          width: fit ? "100%" : undefined,
          maxWidth: "100%",
          background: background || "#ffffff",
        }}
      >
        <Barcode
          value={safeValue}
          format={effectiveFormat as any}
          renderer={renderer}
          width={width}
          height={height}
          displayValue={displayValue}
          font={font}
          fontSize={fontSize}
          textMargin={textMargin}
          background={background}
          lineColor={lineColor}
          margin={margin}
          {...rest}
        />
      </div>
    </BarcodeErrorBoundary>
  );
}
