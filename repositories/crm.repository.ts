import { createAdminDbClient } from "@/lib/db/client";
import {
  CRMCustomer,
  CRMLead,
  CRMNote,
  CommunicationLog,
} from "@/types/crm.types";

// Row shape this file actually reads from the profiles builder select.
interface ProfileDbRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  phone: string | null;
}

export class CRMRepository {
  private getAdminClient() {
    return createAdminDbClient();
  }

  async getCustomers(): Promise<CRMCustomer[]> {
    const db = this.getAdminClient();
    try {
      const { data: customerProfiles } = await db
        .from("profiles")
        .select("*")
        .order("created_at", { ascending: false });

      if (customerProfiles && customerProfiles.length > 0) {
        return customerProfiles.map((cp: ProfileDbRow) => ({
          ...cp,
          profile_id: cp.id,
          first_name: cp.first_name,
          last_name: cp.last_name,
          email: cp.email,
          phone: cp.phone,
        })) as CRMCustomer[];
      }
    } catch {}

    // FIX ROUND 28 (M-2, PROPOSAL): the crm_customers fallback that
    // stood here reads a table that does NOT exist in this schema
    // (Round-28 DDL proposal) and could only ever resolve empty.
    // Profiles is the real customer source (above); when it is empty
    // there are honestly no customers to list.
    return [];
  }

  async getCustomerById(id: string): Promise<CRMCustomer | null> {
    const db = this.getAdminClient();
    // FIX ROUND 28 (M-2, PROPOSAL): was a crm_customers read (phantom
    // table — always null, so CRM detail showed "not found" for real
    // customers). Read the real profiles row and shape it like
    // getCustomers() does; CRM metadata fields stay absent until the
    // crm_customers DDL lands.
    const { data, error } = await db
      .from("profiles")
      .select("*")
      .eq("id", id)
      .single();

    if (error) {
      if (error.code === "PGRST116") return null; // not found
      throw new Error(error.message);
    }
    if (!data) return null;
    const [withProfile] = await this.attachCustomerProfiles(db, [
      { ...data, profile_id: data.id },
    ]);
    return withProfile as CRMCustomer;
  }

  /**
   * REG-83: the customer_profiles(*) embed on crm_customers never
   * attaches (unsupported pair), so the linked profile's name/email/phone
   * were always missing. Fetch profiles explicitly by the profile_id
   * link column and attach under the same key.
   */
  private async attachCustomerProfiles(
    db: ReturnType<typeof createAdminDbClient>,
    rows: Record<string, any>[]
  ): Promise<Record<string, any>[]> {
    if (rows.length === 0) return rows;
    const profileIds = [
      ...new Set(rows.map((r) => r.profile_id).filter(Boolean)),
    ];
    const profileById = new Map<string, any>();
    if (profileIds.length > 0) {
      const { data: profiles } = await db
        .from("profiles")
        .select("*")
        .in("id", profileIds);
      for (const p of profiles || []) {
        if (p?.id) profileById.set(p.id, p);
      }
    }
    return rows.map((r) => ({
      ...r,
      customer_profiles: r.profile_id
        ? profileById.get(r.profile_id) || null
        : null,
    }));
  }

  async getLeads(): Promise<CRMLead[]> {
    const db = this.getAdminClient();
    const { data, error } = await db
      .from("crm_leads")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw new Error(error.message);
    return data;
  }

  async createLead(leadData: Partial<CRMLead>): Promise<CRMLead> {
    const db = this.getAdminClient();
    const { data, error } = await db
      .from("crm_leads")
      .insert(leadData)
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  async updateLead(id: string, updateData: Partial<CRMLead>): Promise<CRMLead> {
    const db = this.getAdminClient();
    const { data, error } = await db
      .from("crm_leads")
      .update(updateData)
      .eq("id", id)
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  async getLeadById(id: string): Promise<CRMLead | null> {
    const db = this.getAdminClient();
    const { data, error } = await db
      .from("crm_leads")
      .select("*")
      .eq("id", id)
      .single();

    if (error) {
      if (error.code === "PGRST116") return null; // not found
      throw new Error(error.message);
    }
    return data;
  }

  async getLeadByEmail(email: string): Promise<CRMLead | null> {
    const db = this.getAdminClient();
    const { data, error } = await db
      .from("crm_leads")
      .select("*")
      .ilike("email", email.trim())
      .maybeSingle();

    if (error) return null;
    return data;
  }

  async deleteLead(id: string): Promise<void> {
    const db = this.getAdminClient();
    try {
      await db.from("communication_logs").delete().eq("lead_id", id);
    } catch {}
    try {
      await db.from("crm_notes").delete().eq("lead_id", id);
    } catch {}
    const { error } = await db.from("crm_leads").delete().eq("id", id);
    if (error) throw new Error(error.message);
  }

  async getNotes(profileId?: string, leadId?: string): Promise<CRMNote[]> {
    const db = this.getAdminClient();
    let query = db
      .from("crm_notes")
      .select("*")
      .order("created_at", { ascending: false });

    if (profileId) {
      query = query.eq("profile_id", profileId);
    } else if (leadId) {
      query = query.eq("lead_id", leadId);
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return data;
  }

  async createNote(noteData: Partial<CRMNote>): Promise<CRMNote> {
    const db = this.getAdminClient();
    const { data, error } = await db
      .from("crm_notes")
      .insert(noteData)
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  async getCommunicationLogs(
    profileId?: string,
    leadId?: string
  ): Promise<CommunicationLog[]> {
    const db = this.getAdminClient();
    let query = db
      .from("communication_logs")
      .select("*")
      .order("created_at", { ascending: false });

    if (profileId) {
      query = query.eq("profile_id", profileId);
    } else if (leadId) {
      query = query.eq("lead_id", leadId);
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return data;
  }

  async createCommunicationLog(
    logData: Partial<CommunicationLog>
  ): Promise<CommunicationLog> {
    const db = this.getAdminClient();
    const { data, error } = await db
      .from("communication_logs")
      .insert(logData)
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  async updateCommunicationLog(
    id: string,
    logData: Partial<CommunicationLog>
  ): Promise<CommunicationLog> {
    const db = this.getAdminClient();
    const { data, error } = await db
      .from("communication_logs")
      .update(logData)
      .eq("id", id)
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  async deleteCommunicationLog(id: string): Promise<void> {
    const db = this.getAdminClient();
    const { error } = await db
      .from("communication_logs")
      .delete()
      .eq("id", id);

    if (error) throw new Error(error.message);
  }
}

export const crmRepository = new CRMRepository();
