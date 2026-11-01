import {
  AnalyticsRepository,
  DateRange,
} from "@/repositories/analytics.repository";

export class AnalyticsService {
  static async getExecutiveSummary(dateRange?: DateRange) {
    try {
      return await AnalyticsRepository.getExecutiveSummary(dateRange);
    } catch (error) {
      throw new Error("Failed to fetch executive analytics");
    }
  }

  static async getSalesAnalytics(dateRange?: DateRange) {
    try {
      return await AnalyticsRepository.getSalesAnalytics(dateRange);
    } catch (error) {
      throw new Error("Failed to fetch sales analytics");
    }
  }

  static async getOrderAnalytics(dateRange?: DateRange) {
    try {
      return await AnalyticsRepository.getOrderAnalytics(dateRange);
    } catch (error) {
      throw new Error("Failed to fetch order analytics");
    }
  }

  static async getCustomerAnalytics(dateRange?: DateRange) {
    try {
      return await AnalyticsRepository.getCustomerAnalytics(dateRange);
    } catch (error) {
      throw new Error("Failed to fetch customer analytics");
    }
  }

  static async getProductAnalytics() {
    try {
      return await AnalyticsRepository.getProductAnalytics();
    } catch (error) {
      throw new Error("Failed to fetch product analytics");
    }
  }

  static async getInventoryAnalytics() {
    try {
      return await AnalyticsRepository.getInventoryAnalytics();
    } catch (error) {
      throw new Error("Failed to fetch inventory analytics");
    }
  }

  static async getMarketingAnalytics(dateRange?: DateRange) {
    try {
      return await AnalyticsRepository.getMarketingAnalytics(dateRange);
    } catch (error) {
      throw new Error("Failed to fetch marketing analytics");
    }
  }
}
