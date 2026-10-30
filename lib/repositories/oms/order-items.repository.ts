import { prisma } from "@/lib/prisma";
import { OrderItem } from "@/types/oms";
import { parseVariantAttributes } from "@/lib/utils/variant-attributes";

export class OrderItemsRepository {
  async getOrderItems(orderId: string, _?: any): Promise<OrderItem[]> {
    try {
      const items = await prisma.orderItem.findMany({
        where: { orderId },
        orderBy: { createdAt: "asc" },
        // S5-1: pull the variant's attribute JSON so size/colour can be
        // surfaced as readable fields — the stored variant_name is
        // unusable for this (it literally repeats the SKU).
        include: { variant: { select: { attributes: true } } },
      });

      return items.map((item) => {
        const attrs = parseVariantAttributes(
          (item as any).variant?.attributes
        );
        return {
          id: item.id,
          order_id: item.orderId,
          product_id: item.productId,
          variant_id: item.variantId,
          sku: item.sku,
          product_name: item.productName,
          variant_name: item.variantName,
          variant_size: attrs.size,
          variant_color: attrs.color,
          variant_label: attrs.label,
          quantity: item.quantity,
          unit_price: Number(item.unitPrice),
          line_total: Number(item.totalPrice),
          total_price: Number(item.totalPrice),
          created_at: item.createdAt.toISOString(),
        };
      }) as unknown as OrderItem[];
    } catch (e) {
      console.error("Error fetching order items:", e);
      return [];
    }
  }

  async createOrderItems(
    items: Omit<OrderItem, "id" | "created_at">[]
  ): Promise<OrderItem[]> {
    const createdItems = await Promise.all(
      items.map(async (item) => {
        return prisma.orderItem.create({
          data: {
            orderId: item.order_id,
            productId: item.product_id,
            variantId: item.variant_id,
            sku: item.sku,
            productName: item.product_name,
            variantName: item.variant_name,
            quantity: item.quantity,
            unitPrice: item.unit_price,
            totalPrice: item.line_total || (item as any).total_price || 0,
          },
        });
      })
    );

    return createdItems.map((item) => ({
      id: item.id,
      order_id: item.orderId,
      product_id: item.productId,
      variant_id: item.variantId,
      sku: item.sku,
      product_name: item.productName,
      variant_name: item.variantName,
      quantity: item.quantity,
      unit_price: Number(item.unitPrice),
      line_total: Number(item.totalPrice),
      total_price: Number(item.totalPrice),
      created_at: item.createdAt.toISOString(),
    })) as unknown as OrderItem[];
  }
}
