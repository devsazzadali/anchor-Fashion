import { describe, it, expect } from "vitest";
import {
  roundMoney,
  normalizeVatPercent,
  vatAmountFor,
  priceWithVat,
  lineVatAmount,
  totalVatAmount,
} from "@/lib/utils/vat";

describe("VAT calculations (per-product rate, added on top of selling price)", () => {
  describe("normalizeVatPercent", () => {
    it("passes through valid rates", () => {
      expect(normalizeVatPercent(7.5)).toBe(7.5);
      expect(normalizeVatPercent("15")).toBe(15);
      expect(normalizeVatPercent(0)).toBe(0);
    });

    it("clamps invalid input to 0", () => {
      expect(normalizeVatPercent(undefined)).toBe(0);
      expect(normalizeVatPercent(null)).toBe(0);
      expect(normalizeVatPercent("abc")).toBe(0);
      expect(normalizeVatPercent(-5)).toBe(0);
      expect(normalizeVatPercent(NaN)).toBe(0);
    });
  });

  describe("vatAmountFor", () => {
    it("is 0 when the rate is 0%", () => {
      expect(vatAmountFor(2500, 0)).toBe(0);
      expect(vatAmountFor(2500, undefined)).toBe(0);
    });

    it("computes a partial percentage exactly", () => {
      expect(vatAmountFor(1000, 7.5)).toBe(75);
      expect(vatAmountFor(2500, 15)).toBe(375);
      expect(vatAmountFor(1850, 5)).toBe(92.5);
    });

    it("rounds to 2 decimals (paisa)", () => {
      // 999 * 7.5% = 74.925 → 74.93
      expect(vatAmountFor(999, 7.5)).toBe(74.93);
      // 333.33 * 15% = 49.9995 → 50
      expect(vatAmountFor(333.33, 15)).toBe(50);
      // 1999 * 7.5% = 149.925 → 149.93
      expect(vatAmountFor(1999, 7.5)).toBe(149.93);
    });

    it("is 0 for zero/negative amounts", () => {
      expect(vatAmountFor(0, 15)).toBe(0);
      expect(vatAmountFor(-100, 15)).toBe(0);
    });
  });

  describe("priceWithVat", () => {
    it("adds VAT on top of the selling price", () => {
      expect(priceWithVat(2500, 7.5)).toBe(2687.5);
      expect(priceWithVat(1000, 15)).toBe(1150);
    });

    it("returns the bare price when the rate is 0%", () => {
      expect(priceWithVat(2500, 0)).toBe(2500);
    });
  });

  describe("lineVatAmount", () => {
    it("multiplies by quantity before applying the rate", () => {
      expect(lineVatAmount(1000, 3, 7.5)).toBe(225);
      expect(lineVatAmount(450, 2, 10)).toBe(90);
    });

    it("is 0 for zero quantity", () => {
      expect(lineVatAmount(1000, 0, 15)).toBe(0);
    });
  });

  describe("totalVatAmount", () => {
    it("sums mixed per-product rates line by line", () => {
      const total = totalVatAmount([
        { unitPrice: 2500, quantity: 1, vatPercent: 7.5 }, // 187.50
        { unitPrice: 1200, quantity: 2, vatPercent: 0 }, // 0
        { unitPrice: 999, quantity: 1, vatPercent: 15 }, // 149.85
      ]);
      expect(total).toBe(337.35);
    });

    it("is 0 for an empty cart", () => {
      expect(totalVatAmount([])).toBe(0);
    });
  });

  describe("roundMoney", () => {
    it("rounds half up to 2 decimals", () => {
      expect(roundMoney(1.005)).toBe(1.01);
      expect(roundMoney(74.925)).toBe(74.93);
      expect(roundMoney(100)).toBe(100);
    });
  });
});
