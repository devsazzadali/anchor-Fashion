import { createDbClient } from "@/lib/db/client";
import { SEOMetadata } from "@/types/seo.types";

export class SEORepository {
  async getMetadataByEntity(
    entityType: string,
    entityId: string
  ): Promise<SEOMetadata | null> {
    const db = await createDbClient();
    const { data, error } = await db
      .from("seo_metadata")
      .select("*")
      .eq("entity_type", entityType)
      .eq("entity_id", entityId)
      .single();

    if (error) {
      if (error.code === "PGRST116") return null;
      throw new Error(error.message);
    }
    return data;
  }

  async upsertMetadata(metadata: Partial<SEOMetadata>): Promise<SEOMetadata> {
    const db = await createDbClient();
    const { data, error } = await db
      .from("seo_metadata")
      .upsert(metadata, { onConflict: "entity_type,entity_id" })
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  async getAllMetadata(): Promise<SEOMetadata[]> {
    const db = await createDbClient();
    const { data, error } = await db
      .from("seo_metadata")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw new Error(error.message);
    return data;
  }
}
