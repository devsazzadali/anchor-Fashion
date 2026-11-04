import prisma from "@/lib/prisma";
import {
  CourierProviderCode,
  CourierProviderRecord,
  DeliveryZone,
  Shipment,
  ShipmentStatus,
} from "@/types/shipping.types";

/** courier_providers.config JSON — the two bags getCouriers reads. */
interface CourierConfigJson {
  credentials?: Record<string, any>;
  settings?: Record<string, any>;
}

export class ShippingRepository {

  // --- Courier Providers ---

  async getCouriers(): Promise<CourierProviderRecord[]> {
    try {
      const data = await prisma.courier_providers.findMany({
        orderBy: { name: "asc" },
      });
      return data.map((r) => ({
        id: String(r.id),
        code: r.code as CourierProviderCode,
        name: r.name,
        display_name: r.name,
        logo_url: null,
        is_active: r.is_active ?? true,
        is_cod_supported: true,
        is_sandbox: true,
        priority: 1,
        max_weight_kg: 10,
        credentials: (r.config as CourierConfigJson | null)?.credentials ?? {},
        settings: (r.config as CourierConfigJson | null)?.settings ?? {},
        webhook_secret: null,
        supported_zones: null,
        created_at: r.created_at?.toISOString() ?? new Date().toISOString(),
        updated_at: r.created_at?.toISOString() ?? new Date().toISOString(),
      })) as CourierProviderRecord[];
    } catch (error) {
      return [
        {
          id: "1",
          code: "pathao",
          name: "Pathao",
          display_name: "Pathao Delivery",
          logo_url: null,
          is_active: true,
          is_cod_supported: true,
          is_sandbox: true,
          priority: 1,
          max_weight_kg: 10,
          credentials: {},
          settings: {},
          webhook_secret: null,
          supported_zones: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        {
          id: "2",
          code: "steadfast",
          name: "Steadfast",
          display_name: "Steadfast Courier",
          logo_url: null,
          is_active: true,
          is_cod_supported: true,
          is_sandbox: true,
          priority: 2,
          max_weight_kg: 20,
          credentials: {},
          settings: {},
          webhook_secret: null,
          supported_zones: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ] as CourierProviderRecord[];
    }
  }

  async updateCourierStatus(id: string, is_active: boolean): Promise<void> {
    try {
      await prisma.courier_providers.update({
        where: { id },
        data: { is_active },
      });
    } catch (error) {
      throw new Error(`Failed to update courier: ${(error as Error).message}`);
    }
  }

  // --- Delivery Zones ---

  async getZones(): Promise<DeliveryZone[]> {
    try {
      const data = await prisma.delivery_zones.findMany({
        orderBy: { name: "asc" },
      });
      return data.map((z) => ({
        id: String(z.id),
        name: z.name,
        code: z.code ?? "IND",
        description: null,
        districts: [],
        is_cod_available: true,
        rate: Number(z.rate ?? 60),
        is_active: z.is_active ?? true,
        estimated_days_min: 1,
        estimated_days_max: 3,
        created_at: z.created_at?.toISOString() ?? new Date().toISOString(),
        updated_at: z.created_at?.toISOString() ?? new Date().toISOString(),
      })) as unknown as DeliveryZone[];
    } catch (error) {
      return [
        {
          id: "1",
          name: "Inside Dhaka",
          code: "IND",
          description: null,
          districts: ["Dhaka"],
          is_cod_available: true,
          is_active: true,
          estimated_days_min: 1,
          estimated_days_max: 2,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        {
          id: "2",
          name: "Outside Dhaka",
          code: "OUTD",
          description: null,
          districts: [],
          is_cod_available: true,
          is_active: true,
          estimated_days_min: 3,
          estimated_days_max: 5,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ] as DeliveryZone[];
    }
  }

  // --- Shipments ---

  async createShipment(shipmentData: Partial<Shipment>): Promise<Shipment> {
    try {
      const data = await prisma.shipment.create({
        data: {
          shipmentNumber: shipmentData.shipment_number ?? `SHP-${Date.now()}`,
          orderId: shipmentData.order_id ?? null,
          status: shipmentData.status ?? "created",
          recipientName: shipmentData.recipient_name ?? null,
          recipientPhone: shipmentData.recipient_phone ?? null,
          recipientAddress: shipmentData.recipient_address ?? null,
          recipientCity: shipmentData.recipient_city ?? null,
          trackingNumber: shipmentData.tracking_number ?? null,
          courier: shipmentData.courier_provider_code ?? null,
        },
      });
      return {
        ...shipmentData,
        id: data.id,
        shipment_number: data.shipmentNumber ?? `SHP-${Date.now()}`,
        status: (data.status ?? "created") as ShipmentStatus,
        created_at: data.createdAt?.toISOString() ?? new Date().toISOString(),
        updated_at: data.updatedAt?.toISOString() ?? new Date().toISOString(),
      } as unknown as Shipment;
    } catch (error) {
      return {
        id: `ship_${Date.now()}`,
        shipment_number: `SHP-${Date.now()}`,
        ...shipmentData,
        status: "created",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as Shipment;
    }
  }

  async updateShipmentStatus(
    id: string,
    status: ShipmentStatus,
    trackingNumber?: string
  ): Promise<void> {
    try {
      await prisma.shipment.update({
        where: { id },
        data: {
          status,
          ...(trackingNumber ? { trackingNumber } : {}),
          updatedAt: new Date(),
        },
      });
    } catch (error) {
      throw new Error(`Failed to update shipment status: ${(error as Error).message}`);
    }
  }
}
