"use client";

import { useState, useMemo, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ClientBarcode } from "@/components/ui/ClientBarcode";
import {
  Printer,
  SlidersHorizontal,
  Layers,
  Search,
  RotateCcw,
  CheckSquare,
  Square,
  Plus,
  Minus,
  Zap,
  AlertTriangle,
} from "lucide-react";

/** A label can only be printed when the variant carries a real barcode.
 *  Barcode-less variants are excluded from printing (never substitute a
 *  dummy/shared number — a printed sticker must scan back to its variant). */
const hasBarcode = (l: BarcodeLabelData) => !!l.barcode?.trim();

export interface BarcodeLabelData {
  productName: string;
  sku: string;
  barcode: string;
  color?: string;
  size?: string;
  price: number;
  stock?: number;
  styleCode?: string;
  categoryName?: string;
  brandName?: string;
  tag?: string;
}

interface PrintBarcodeModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  labels: BarcodeLabelData[];
}

export type PaperMode =
  | "thermal_50_30" // 50mm x 30mm (Standard garment sticker roll)
  | "thermal_50_25" // 50mm x 25mm (Compact sticker roll)
  | "a4_dense_4col" // A4 dense 4 columns (Full page coverage)
  | "a4_3col"; // A4 standard 3 columns

export function PrintBarcodeModal({
  open,
  onOpenChange,
  labels = [],
}: PrintBarcodeModalProps) {
  // Paper & Printer mode
  const [paperMode, setPaperMode] = useState<PaperMode>("thermal_50_30");

  // Per-variant quantities: key = sku, value = count
  const [quantities, setQuantities] = useState<Record<string, number>>({});

  // Selected variants (to include/exclude)
  const [selectedSkus, setSelectedSkus] = useState<Set<string>>(new Set());

  // Filtering
  const [filterColor, setFilterColor] = useState<string>("ALL");
  const [filterSize, setFilterSize] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState<string>("");

  // Customization panel toggle
  const [activeTab, setActiveTab] = useState<"preview" | "customize">("preview");

  // Bulk quantity input
  const [bulkQty, setBulkQty] = useState<number>(1);

  // Initialize quantities and selection when labels change
  useEffect(() => {
    if (labels.length > 0) {
      const initialQty: Record<string, number> = {};
      const initialSelected = new Set<string>();

      labels.forEach((l) => {
        // Default print quantity matches actual stock quantity (or 1 if stock is 0 or undefined)
        const defQty = typeof l.stock === "number" && l.stock > 0 ? l.stock : 1;
        initialQty[l.sku] = defQty;
        // Barcode-less variants start unselected: they can never be printed.
        if (hasBarcode(l)) initialSelected.add(l.sku);
      });

      setQuantities(initialQty);
      setSelectedSkus(initialSelected);
    }
  }, [labels, open]);

  // Unique colors and sizes for dropdown filters
  const uniqueColors = useMemo(() => {
    const set = new Set<string>();
    labels.forEach((l) => {
      if (l.color && l.color.trim()) set.add(l.color.trim());
    });
    return Array.from(set).sort();
  }, [labels]);

  const uniqueSizes = useMemo(() => {
    const set = new Set<string>();
    labels.forEach((l) => {
      if (l.size && l.size.trim()) set.add(l.size.trim());
    });
    return Array.from(set).sort();
  }, [labels]);

  // Filtered labels
  const filteredLabels = useMemo(() => {
    return labels.filter((lbl) => {
      if (filterColor !== "ALL" && lbl.color !== filterColor) return false;
      if (filterSize !== "ALL" && lbl.size !== filterSize) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchesSku = lbl.sku?.toLowerCase().includes(q);
        const matchesBarcode = lbl.barcode?.toLowerCase().includes(q);
        const matchesColor = lbl.color?.toLowerCase().includes(q);
        const matchesSize = lbl.size?.toLowerCase().includes(q);
        const matchesName = lbl.productName?.toLowerCase().includes(q);
        if (!matchesSku && !matchesBarcode && !matchesColor && !matchesSize && !matchesName) {
          return false;
        }
      }
      return true;
    });
  }, [labels, filterColor, filterSize, searchQuery]);

  // Variants without a barcode (within the current filter view) — excluded
  // from printing and surfaced in a visible notice instead of being printed
  // with a fake/shared number.
  const noBarcodeLabels = useMemo(
    () => filteredLabels.filter((l) => !hasBarcode(l)),
    [filteredLabels]
  );

  // Flat list of all printable stickers
  const printableStickers = useMemo(() => {
    const result: Array<{ label: BarcodeLabelData; index: number; totalForVariant: number }> = [];

    filteredLabels.forEach((lbl) => {
      if (!hasBarcode(lbl)) return;
      if (!selectedSkus.has(lbl.sku)) return;
      const count = quantities[lbl.sku] ?? 0;
      for (let i = 0; i < count; i++) {
        result.push({
          label: lbl,
          index: i + 1,
          totalForVariant: count,
        });
      }
    });

    return result;
  }, [filteredLabels, selectedSkus, quantities]);

  const totalStickersToPrint = printableStickers.length;

  // Actions
  const handlePrint = () => {
    window.print();
  };

  const handleToggleSku = (sku: string) => {
    // Barcode-less variants can never be selected for print.
    const lbl = labels.find((l) => l.sku === sku);
    if (lbl && !hasBarcode(lbl)) return;
    setSelectedSkus((prev) => {
      const next = new Set(prev);
      if (next.has(sku)) {
        next.delete(sku);
      } else {
        next.add(sku);
      }
      return next;
    });
  };

  const handleSelectAll = (select: boolean) => {
    if (select) {
      // Only barcoded variants are selectable for print.
      setSelectedSkus(
        new Set(filteredLabels.filter(hasBarcode).map((l) => l.sku))
      );
    } else {
      setSelectedSkus(new Set());
    }
  };

  const handleUpdateQty = (sku: string, qty: number) => {
    setQuantities((prev) => ({
      ...prev,
      [sku]: Math.max(0, qty),
    }));
  };

  // Quick Action: Match warehouse stock quantities
  const handleResetToStockQty = () => {
    const updated: Record<string, number> = {};
    labels.forEach((l) => {
      updated[l.sku] = typeof l.stock === "number" && l.stock > 0 ? l.stock : 1;
    });
    setQuantities(updated);
    setSelectedSkus(new Set(labels.filter(hasBarcode).map((l) => l.sku)));
  };

  // Quick Action: Set 1 copy for each
  const handleSetAllToOne = () => {
    const updated: Record<string, number> = {};
    labels.forEach((l) => {
      updated[l.sku] = 1;
    });
    setQuantities(updated);
  };

  // Quick Action: Bulk apply number
  const handleApplyBulkQty = () => {
    const val = Math.max(1, bulkQty);
    setQuantities((prev) => {
      const updated = { ...prev };
      filteredLabels.forEach((l) => {
        if (selectedSkus.has(l.sku)) {
          updated[l.sku] = val;
        }
      });
      return updated;
    });
  };

  // Quick Action: Clear all
  const handleClearAll = () => {
    const updated: Record<string, number> = {};
    labels.forEach((l) => {
      updated[l.sku] = 0;
    });
    setQuantities(updated);
  };

  const isThermal = paperMode.startsWith("thermal");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[92vh] flex flex-col p-0 overflow-hidden bg-background">
        {/* Header */}
        <DialogHeader className="p-5 pb-3 border-b bg-muted/20">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <DialogTitle className="text-xl font-bold flex items-center gap-2">
                <Printer className="h-5 w-5 text-emerald-600" />
                Barcode Label Customizer &amp; Print
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                Support for 1-by-1 thermal sticker rolls and dense edge-to-edge A4 sticker sheets.
              </DialogDescription>
            </div>

            {/* Total sticker badge */}
            <div className="flex items-center gap-2">
              <Badge
                variant="outline"
                className="px-3 py-1.5 bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 font-bold text-xs"
              >
                <Layers className="h-3.5 w-3.5 mr-1 text-emerald-600" />
                {totalStickersToPrint} Stickers Ready
              </Badge>
              <Button
                onClick={handlePrint}
                disabled={totalStickersToPrint === 0}
                className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold gap-2 text-xs h-9 px-4 cursor-pointer shadow"
              >
                <Printer className="h-4 w-4" />
                Print Stickers Now
              </Button>
            </div>
          </div>
        </DialogHeader>

        {/* Control Bar: Paper Mode, Filters, and Actions */}
        <div className="p-4 border-b bg-muted/30 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
            {/* Paper / Printer Mode Selector */}
            <div className="md:col-span-4 flex items-center gap-2">
              <Label className="text-xs font-semibold shrink-0 text-muted-foreground">
                Printer / Paper:
              </Label>
              <Select
                value={paperMode}
                onValueChange={(val: PaperMode) => setPaperMode(val)}
              >
                <SelectTrigger className="h-8 text-xs bg-background font-medium">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="thermal_50_30" className="text-xs">
                    🏷️ Thermal Roll (50mm × 30mm) - 1 Label / Page
                  </SelectItem>
                  <SelectItem value="thermal_50_25" className="text-xs">
                    🏷️ Thermal Roll (50mm × 25mm) - Compact Roll
                  </SelectItem>
                  <SelectItem value="a4_dense_4col" className="text-xs">
                    📄 A4 Sheet (Dense 4 Columns - Full Page)
                  </SelectItem>
                  <SelectItem value="a4_3col" className="text-xs">
                    📄 A4 Sheet (Standard 3 Columns - 24/sheet)
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Color Filter */}
            <div className="md:col-span-2 flex items-center gap-1.5">
              <Select value={filterColor} onValueChange={setFilterColor}>
                <SelectTrigger className="h-8 text-xs bg-background">
                  <SelectValue placeholder="Color" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL" className="text-xs">
                    All Colors ({uniqueColors.length})
                  </SelectItem>
                  {uniqueColors.map((c) => (
                    <SelectItem key={c} value={c} className="text-xs">
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Size Filter */}
            <div className="md:col-span-2 flex items-center gap-1.5">
              <Select value={filterSize} onValueChange={setFilterSize}>
                <SelectTrigger className="h-8 text-xs bg-background">
                  <SelectValue placeholder="Size" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL" className="text-xs">
                    All Sizes ({uniqueSizes.length})
                  </SelectItem>
                  {uniqueSizes.map((s) => (
                    <SelectItem key={s} value={s} className="text-xs">
                      Size: {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Search Input */}
            <div className="md:col-span-4 relative">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search SKU, size, or barcode..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-8 pl-8 text-xs bg-background"
              />
            </div>
          </div>

          {/* Quick Actions & Navigation Tabs */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-border/50 text-xs">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-muted-foreground font-medium">Quick Set:</span>
              <Button
                variant="outline"
                size="sm"
                onClick={handleResetToStockQty}
                className="h-7 text-[11px] gap-1 px-2.5 bg-background hover:bg-muted font-medium cursor-pointer"
                title="Sets print quantity to actual warehouse stock count for each variant"
              >
                <RotateCcw className="h-3 w-3 text-emerald-600" />
                Match Stock Qty (Default)
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={handleSetAllToOne}
                className="h-7 text-[11px] gap-1 px-2 bg-background hover:bg-muted font-medium cursor-pointer"
              >
                1 Copy Each
              </Button>

              <div className="flex items-center gap-1 bg-background border rounded px-1 py-0.5">
                <Input
                  type="number"
                  min={1}
                  max={500}
                  value={bulkQty}
                  onChange={(e) => setBulkQty(Math.max(1, parseInt(e.target.value) || 1))}
                  className="w-12 h-6 text-xs text-center border-0 p-0"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleApplyBulkQty}
                  className="h-6 text-[10px] px-1.5 font-bold cursor-pointer"
                >
                  Apply All
                </Button>
              </div>

              <Button
                variant="ghost"
                size="sm"
                onClick={handleClearAll}
                className="h-7 text-[11px] px-2 text-muted-foreground hover:text-red-600 cursor-pointer"
              >
                Clear (0)
              </Button>
            </div>

            {/* View Switcher: Live Preview vs Variant Customizer */}
            <div className="flex items-center gap-1.5">
              <Button
                variant={activeTab === "preview" ? "default" : "outline"}
                size="sm"
                onClick={() => setActiveTab("preview")}
                className="h-7 text-xs gap-1.5 cursor-pointer"
              >
                <Printer className="h-3.5 w-3.5" />
                Live Sheet Preview ({totalStickersToPrint})
              </Button>
              <Button
                variant={activeTab === "customize" ? "default" : "outline"}
                size="sm"
                onClick={() => setActiveTab("customize")}
                className="h-7 text-xs gap-1.5 cursor-pointer"
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
                Customize Variants ({filteredLabels.length})
              </Button>
            </div>
          </div>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-4 min-h-[360px] bg-zinc-100/60 dark:bg-zinc-950/40">
          {activeTab === "customize" ? (
            /* Variant Customization Table */
            <div className="bg-background rounded-xl border shadow-sm overflow-hidden">
              <div className="p-3 bg-muted/40 border-b flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      handleSelectAll(
                        selectedSkus.size !== filteredLabels.filter(hasBarcode).length
                      )
                    }
                    className="h-7 text-xs gap-1.5 cursor-pointer px-2"
                  >
                    {selectedSkus.size === filteredLabels.filter(hasBarcode).length ? (
                      <CheckSquare className="h-4 w-4 text-emerald-600" />
                    ) : (
                      <Square className="h-4 w-4 text-muted-foreground" />
                    )}
                    Select All ({filteredLabels.length})
                  </Button>
                  <span className="text-muted-foreground">
                    ({selectedSkus.size} variants included in print)
                  </span>
                </div>
              </div>

              <div className="divide-y divide-border">
                {filteredLabels.map((lbl) => {
                  const noBarcode = !hasBarcode(lbl);
                  const isChecked = !noBarcode && selectedSkus.has(lbl.sku);
                  const qty = quantities[lbl.sku] ?? 0;
                  const stock = lbl.stock ?? 0;

                  return (
                    <div
                      key={lbl.sku}
                      className={`p-3 flex items-center justify-between gap-4 transition-colors ${
                        isChecked ? "bg-background" : "bg-muted/20 opacity-60"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => handleToggleSku(lbl.sku)}
                          disabled={noBarcode}
                          className="cursor-pointer text-foreground hover:text-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {isChecked ? (
                            <CheckSquare className="h-5 w-5 text-emerald-600" />
                          ) : (
                            <Square className="h-5 w-5 text-muted-foreground" />
                          )}
                        </button>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-xs text-foreground">
                              {lbl.productName}
                            </span>
                            {lbl.color && (
                              <Badge variant="outline" className="text-[10px] py-0 px-1.5 font-normal">
                                {lbl.color}
                              </Badge>
                            )}
                            {lbl.size && (
                              <Badge variant="secondary" className="text-[10px] py-0 px-1.5 font-bold">
                                Size: {lbl.size}
                              </Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-3 text-[11px] text-muted-foreground mt-0.5">
                            <span className="font-mono">SKU: {lbl.sku}</span>
                            {noBarcode ? (
                              <span className="inline-flex items-center gap-1 font-bold text-red-600">
                                <AlertTriangle className="h-3 w-3" />
                                No barcode — excluded from print
                              </span>
                            ) : (
                              <span className="font-mono">Barcode: {lbl.barcode}</span>
                            )}
                            <span className="text-emerald-600 font-semibold">
                              Warehouse Stock: {stock} units
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Quantity Stepper */}
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground font-medium">
                          Copies:
                        </span>
                        <div className="flex items-center border rounded-lg bg-background">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => handleUpdateQty(lbl.sku, qty - 1)}
                            disabled={qty <= 0 || noBarcode}
                            className="h-7 w-7 rounded-none rounded-l-lg cursor-pointer"
                          >
                            <Minus className="h-3 w-3" />
                          </Button>
                          <Input
                            type="number"
                            min={0}
                            max={1000}
                            value={qty}
                            disabled={noBarcode}
                            onChange={(e) =>
                              handleUpdateQty(
                                lbl.sku,
                                Math.max(0, parseInt(e.target.value) || 0)
                              )
                            }
                            className="w-14 h-7 text-xs text-center border-0 p-0 font-bold focus-visible:ring-0"
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => handleUpdateQty(lbl.sku, qty + 1)}
                            disabled={noBarcode}
                            className="h-7 w-7 rounded-none rounded-r-lg cursor-pointer"
                          >
                            <Plus className="h-3 w-3" />
                          </Button>
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={noBarcode}
                          onClick={() => {
                            setSelectedSkus(new Set([lbl.sku]));
                            handleUpdateQty(lbl.sku, 1);
                          }}
                          className="h-7 text-[10px] px-2 text-muted-foreground hover:text-foreground cursor-pointer"
                          title="Print only 1 sticker of this variant"
                        >
                          Print Only This
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            /* Printable Live Preview Area */
            <div>
              {/* Notice Banner */}
              <div className="mb-3 px-3 py-2 bg-emerald-500/10 border border-emerald-500/30 rounded-lg flex items-center justify-between text-xs text-emerald-800 dark:text-emerald-300">
                <div className="flex items-center gap-2">
                  <Zap className="h-4 w-4 text-emerald-600 shrink-0" />
                  <span>
                    <strong>Exact Sticker Design:</strong> High-contrast vector SVG barcode ensures laser and camera scanners read instantly without zooming.
                  </span>
                </div>
                <span className="text-[11px] font-mono font-medium">
                  Mode: {isThermal ? "Thermal Roll (1 per page)" : "A4 Sheet (Dense Page)"}
                </span>
              </div>

              {/* No-barcode exclusion notice: these variants are NOT printed —
                  a sticker must carry the variant's real barcode. */}
              {noBarcodeLabels.length > 0 && (
                <div className="mb-3 px-3 py-2 bg-amber-500/10 border border-amber-500/40 rounded-lg flex items-start gap-2 text-xs text-amber-800 dark:text-amber-300">
                  <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-px" />
                  <span>
                    <strong>
                      {noBarcodeLabels.length} variant
                      {noBarcodeLabels.length === 1 ? " has" : "s have"} no
                      barcode and {noBarcodeLabels.length === 1 ? "is" : "are"}{" "}
                      excluded from printing:
                    </strong>{" "}
                    <span className="font-mono">
                      {noBarcodeLabels.map((l) => l.sku).join(", ")}
                    </span>
                    . Assign a barcode from the product editor, then reopen
                    this dialog to print {noBarcodeLabels.length === 1 ? "it" : "them"}.
                  </span>
                </div>
              )}

              {printableStickers.length === 0 ? (
                <div className="p-12 text-center bg-background rounded-xl border border-dashed text-muted-foreground text-sm">
                  No stickers selected to print. Select variants or increase copy counts in the &ldquo;Customize Variants&rdquo; tab.
                </div>
              ) : (
                <div
                  id="printable-barcode-sheet"
                  className={`bg-white text-black p-3 rounded-xl shadow-sm border border-zinc-200 ${
                    isThermal ? "flex flex-wrap gap-3 justify-center" : ""
                  }`}
                >
                  {/* Dynamic CSS strictly for printing */}
                  <style jsx global>{`
                    @media print {
                      body * {
                        visibility: hidden !important;
                      }
                      #printable-barcode-sheet,
                      #printable-barcode-sheet * {
                        visibility: visible !important;
                      }
                      #printable-barcode-sheet {
                        position: absolute !important;
                        left: 0 !important;
                        top: 0 !important;
                        width: 100% !important;
                        margin: 0 !important;
                        padding: 0 !important;
                        border: none !important;
                        background: #ffffff !important;
                        box-shadow: none !important;
                      }

                      /* Page Sizing */
                      @page {
                        size: ${paperMode === "thermal_50_30"
                          ? "50mm 30mm"
                          : paperMode === "thermal_50_25"
                          ? "50mm 25mm"
                          : "A4 portrait"};
                        margin: ${paperMode.startsWith("thermal") ? "0mm" : "5mm 4mm"};
                      }

                      /* Thermal Roll: 1 label per page strictly */
                      .print-thermal-sticker {
                        width: 50mm !important;
                        height: ${paperMode === "thermal_50_25" ? "25mm" : "30mm"} !important;
                        max-width: 50mm !important;
                        max-height: ${paperMode === "thermal_50_25" ? "25mm" : "30mm"} !important;
                        page-break-after: always !important;
                        break-after: page !important;
                        box-sizing: border-box !important;
                        margin: 0 !important;
                        padding: 1.5mm 2.2mm !important;
                        border: none !important;
                        border-radius: 0 !important;
                        display: flex !important;
                        flex-direction: column !important;
                        justify-content: space-between !important;
                        overflow: hidden !important;
                        background: #ffffff !important;
                      }

                      /* A4 Sheet Mode: Dense compact grid covering entire page */
                      .print-a4-container {
                        display: grid !important;
                        grid-template-columns: ${paperMode === "a4_3col"
                          ? "repeat(3, 1fr)"
                          : "repeat(4, 1fr)"} !important;
                        gap: 2mm !important;
                        width: 100% !important;
                        margin: 0 !important;
                        padding: 0 !important;
                      }

                      .print-a4-sticker {
                        break-inside: avoid !important;
                        page-break-inside: avoid !important;
                        box-sizing: border-box !important;
                        height: 30mm !important;
                        max-height: 30mm !important;
                        padding: 1.5mm 2mm !important;
                        border: 1px dashed #d1d5db !important;
                        display: flex !important;
                        flex-direction: column !important;
                        justify-content: space-between !important;
                        overflow: hidden !important;
                        background: #ffffff !important;
                      }
                    }
                  `}</style>

                  {/* Render Printable Stickers */}
                  <div
                    className={
                      isThermal
                        ? "flex flex-wrap gap-3 justify-center w-full"
                        : `print-a4-container w-full grid gap-2 ${
                            paperMode === "a4_3col"
                              ? "grid-cols-2 md:grid-cols-3"
                              : "grid-cols-2 md:grid-cols-4"
                          }`
                    }
                  >
                    {printableStickers.map(({ label: lbl }, sIdx) => {
                      // Some callers bake "(Color - Size)" into the product
                      // name; that pair belongs in the bottom row, so show the
                      // clean name up top and reuse the parsed values when the
                      // label has no explicit color/size fields.
                      const suffixMatch = lbl.productName.match(
                        /^(.*?)\s*\((.+?)\s*-\s*(.+?)\)\s*$/
                      );
                      const displayName = suffixMatch
                        ? suffixMatch[1]
                        : lbl.productName;
                      const colorText =
                        lbl.color || (suffixMatch ? suffixMatch[2] : undefined);
                      const sizeText =
                        lbl.size || (suffixMatch ? suffixMatch[3] : undefined);
                      return (
                      <div
                        key={`${lbl.sku}-${sIdx}`}
                        className={`bg-white text-black rounded-[4px] border border-zinc-300 p-[2mm] flex flex-col justify-between shadow-xs select-none ${
                          isThermal
                            ? `print-thermal-sticker w-[50mm] min-w-[50mm] ${
                                paperMode === "thermal_50_25"
                                  ? "h-[25mm] min-h-[25mm]"
                                  : "h-[30mm] min-h-[30mm]"
                              }`
                            : "print-a4-sticker w-full h-[30mm]"
                        }`}
                        style={{
                          boxSizing: "border-box",
                        }}
                      >
                        {/* STICKER LAYOUT (owner spec, final): header = brand +
                            SMALL product name (modest bold, 1 line, truncated)
                            + a subtle second line with Color · Size (left) and
                            the SKU (right); middle = full-width barcode with
                            the number directly under the bars; bottom = price
                            ONLY, a full-width band at the original size. */}
                        {/* Header: brand, small product name, Color·Size | SKU */}
                        <div className="leading-tight">
                          <div
                            className={`text-center font-black uppercase text-zinc-950 ${
                              paperMode === "thermal_50_25"
                                ? "text-[8.5px] tracking-[0.22em]"
                                : "text-[9.5px] tracking-[0.24em]"
                            }`}
                          >
                            {lbl.brandName || "Anchor Fashion"}
                          </div>
                          <div
                            className={`text-center font-bold text-zinc-900 truncate tracking-tight ${
                              paperMode === "thermal_50_25" ? "text-[8px]" : "text-[9.5px]"
                            }`}
                          >
                            {displayName}
                          </div>
                          <div className="flex items-baseline justify-between gap-1 tracking-tight">
                            <span className="min-w-0 truncate text-[8px] font-semibold text-zinc-600">
                              {[colorText, sizeText].filter(Boolean).join(" · ")}
                            </span>
                            <span className="shrink-0 font-mono text-[7.5px] font-semibold text-zinc-500">
                              {lbl.styleCode || lbl.sku}
                            </span>
                          </div>
                        </div>

                        {/* Middle: full-width centered barcode, number under the bars.
                            Only the variant's REAL barcode is ever rendered —
                            barcode-less variants are excluded before this point. */}
                        <div className="barcode-svg-clean flex w-full items-center justify-center my-auto px-[1mm]">
                          <ClientBarcode
                            value={lbl.barcode}
                            format="CODE128"
                            width={1.4}
                            height={paperMode === "thermal_50_25" ? 19 : 25}
                            fontSize={9}
                            margin={0}
                            textMargin={1}
                            displayValue={true}
                            fit
                            className="w-full"
                          />
                        </div>

                        {/* Bottom: price ONLY, full-width band, original size */}
                        <div className="border-t border-zinc-200/90 pt-[0.8mm] leading-none text-center">
                          <span className="text-[9.5px] font-black tracking-tight text-zinc-950 whitespace-nowrap">
                            TK.{Number(lbl.price || 0).toLocaleString("en-US", {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                            <span className="text-[7px] font-bold">(Inc.VAT)</span>
                          </span>
                        </div>
                      </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <DialogFooter className="p-4 border-t bg-muted/20 flex flex-row items-center justify-between">
          <div className="text-xs text-muted-foreground">
            Total to Print: <strong className="text-foreground">{totalStickersToPrint} stickers</strong> across{" "}
            <strong className="text-foreground">{selectedSkus.size} variants</strong>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              className="text-xs cursor-pointer"
            >
              Close
            </Button>
            <Button
              size="sm"
              onClick={handlePrint}
              disabled={totalStickersToPrint === 0}
              className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold gap-2 text-xs cursor-pointer shadow"
            >
              <Printer className="h-4 w-4" />
              Print ({totalStickersToPrint})
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
