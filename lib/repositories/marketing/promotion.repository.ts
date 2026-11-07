import { prisma } from "@/lib/prisma";

export interface PromotionRecord {
  id: string;
  name: string;
  discount_percentage: number;
  start_date: string;
  end_date: string;
  is_active: boolean;
  banner_url?: string;
  banner_link?: string;
  show_popup?: boolean;
  popup_delay?: number;
  description?: string;
  created_at: string;
}

export interface CreatePromotionInput {
  name: string;
  discount_percentage: number;
  start_date: string;
  end_date: string;
  is_active?: boolean;
  banner_url?: string;
  banner_link?: string;
  show_popup?: boolean;
  popup_delay?: number;
  description?: string;
}

function mapPromotion(row: any): PromotionRecord {
  return {
    id: row.id,
    name: row.title ?? "",
    discount_percentage: row.value != null ? Number(row.value) : 0,
    start_date: row.start_date ? new Date(row.start_date).toISOString() : "",
    end_date: row.end_date ? new Date(row.end_date).toISOString() : "",
    is_active: row.is_active ?? true,
    banner_url: "",
    banner_link: "",
    show_popup: true,
    popup_delay: 5,
    description: row.description || "",
    created_at: row.created_at
      ? new Date(row.created_at).toISOString()
      : new Date().toISOString(),
  };
}

export class PromotionRepository {
  static async getPromotions(): Promise<PromotionRecord[]> {
    const rows = await prisma.promotions.findMany({
      orderBy: { created_at: "desc" },
    });
    return rows.map(mapPromotion);
  }

  static async getPromotionById(id: string): Promise<PromotionRecord | null> {
    const row = await prisma.promotions.findUnique({
      where: { id },
    });
    return row ? mapPromotion(row) : null;
  }

  static async createPromotion(
    input: CreatePromotionInput
  ): Promise<PromotionRecord> {
    const row = await prisma.promotions.create({
      data: {
        title: input.name,
        description: input.description || null,
        type: "PERCENTAGE",
        value: input.discount_percentage,
        start_date: input.start_date ? new Date(input.start_date) : null,
        end_date: input.end_date ? new Date(input.end_date) : null,
        is_active: input.is_active ?? true,
      },
    });
    return mapPromotion(row);
  }

  static async updatePromotion(
    id: string,
    updates: Partial<PromotionRecord>
  ): Promise<PromotionRecord> {
    const data: Record<string, any> = {};
    if (updates.name !== undefined) data.title = updates.name;
    if (updates.discount_percentage !== undefined)
      data.value = updates.discount_percentage;
    if (updates.start_date !== undefined)
      data.start_date = updates.start_date ? new Date(updates.start_date) : null;
    if (updates.end_date !== undefined)
      data.end_date = updates.end_date ? new Date(updates.end_date) : null;
    if (updates.is_active !== undefined) data.is_active = updates.is_active;
    if (updates.description !== undefined)
      data.description = updates.description || null;

    const row = await prisma.promotions.update({
      where: { id },
      data,
    });
    return mapPromotion(row);
  }

  static async togglePromotionStatus(
    id: string,
    is_active: boolean
  ): Promise<PromotionRecord> {
    const row = await prisma.promotions.update({
      where: { id },
      data: { is_active },
    });
    return mapPromotion(row);
  }

  static async deletePromotion(id: string): Promise<void> {
    await prisma.promotions.delete({
      where: { id },
    });
  }

  static async getBestActivePromotion(): Promise<PromotionRecord | null> {
    const now = new Date();
    const rows = await prisma.promotions.findMany({
      where: {
        is_active: true,
        AND: [
          {
            OR: [{ start_date: null }, { start_date: { lte: now } }],
          },
          {
            OR: [{ end_date: null }, { end_date: { gte: now } }],
          },
        ],
      },
      orderBy: { value: "desc" },
      take: 1,
    });
    return rows.length > 0 ? mapPromotion(rows[0]) : null;
  }
}
