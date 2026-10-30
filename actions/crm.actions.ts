"use server";

import { revalidatePath } from "next/cache";
import { crmService } from "@/services/crm.service";
import { cleanupFakeMessages } from "@/actions/admin/messages.actions";
import { verifyStaff } from "@/lib/security/roles";

export async function getCustomersAction() {
  // SECURITY: server actions are public endpoints; authorize every call.
  await verifyStaff();
  try {
    const customers = await crmService.getCustomers();
    return { data: customers };
  } catch (error: any) {
    return { error: error.message };
  }
}

export async function getCustomerTimelineAction(profileId: string) {
  // SECURITY: server actions are public endpoints; authorize every call.
  await verifyStaff();
  try {
    const timeline = await crmService.getCustomerTimeline(profileId);
    return { data: timeline };
  } catch (error: any) {
    return { error: error.message };
  }
}

export async function getLeadsAction() {
  // SECURITY: server actions are public endpoints; authorize every call.
  await verifyStaff();
  try {
    const leads = await crmService.getLeads();
    return { data: leads };
  } catch (error: any) {
    return { error: error.message };
  }
}

export async function getLeadByIdAction(id: string) {
  // SECURITY: server actions are public endpoints; authorize every call.
  await verifyStaff();
  try {
    const lead = await crmService.getLeadById(id);
    return { data: lead };
  } catch (error: any) {
    return { error: error.message };
  }
}

export async function deleteLeadAction(id: string) {
  // SECURITY: server actions are public endpoints; authorize every call.
  await verifyStaff();
  try {
    await crmService.deleteLead(id);
    revalidatePath("/admin/crm/leads");
    return { success: true };
  } catch (error: any) {
    return { error: error.message };
  }
}

export async function createLeadAction(data: unknown) {
  // SECURITY: server actions are public endpoints; authorize every call.
  await verifyStaff();
  try {
    const lead = await crmService.createLead(data);
    revalidatePath("/admin/crm/leads");
    return { data: lead };
  } catch (error: any) {
    if (error?.errors && Array.isArray(error.errors) && error.errors.length > 0) {
      return { error: error.errors[0]?.message || "Validation failed" };
    }
    return { error: error.message || "Failed to create lead" };
  }
}

/**
 * PUBLIC endpoint for the storefront "Contact Us" form (REG-38).
 *
 * This action intentionally does NOT call verifyStaff: it exists for
 * guests. The staff-only createLeadAction above was previously (mis)used
 * by the public form, and its verifyStaff() — invoked OUTSIDE the
 * try/catch — threw "Unauthorized" for every guest, which escaped the
 * action as an unhandled server error (the client-visible "Server
 * Components render" crash) and lost every message. Safety here comes
 * from the strict contactMessageSchema in the service (bounded fields,
 * valid email, no lead-field smuggling) and a write surface limited to
 * crm_leads + crm_notes.
 */
export async function submitContactMessageAction(data: unknown) {
  try {
    const lead = await crmService.submitContactMessage(data);
    revalidatePath("/admin/crm/leads");
    return { data: lead };
  } catch (error: any) {
    const issues = error?.errors || error?.issues;
    if (issues && Array.isArray(issues) && issues.length > 0) {
      return { error: issues[0]?.message || "Validation failed" };
    }
    return { error: error.message || "Failed to send message" };
  }
}

export async function updateLeadAction(id: string, data: unknown) {
  // SECURITY: server actions are public endpoints; authorize every call.
  await verifyStaff();
  try {
    const lead = await crmService.updateLead(id, data);
    revalidatePath("/admin/crm/leads");
    return { data: lead };
  } catch (error: any) {
    if (error?.errors && Array.isArray(error.errors) && error.errors.length > 0) {
      return { error: error.errors[0]?.message || "Validation failed" };
    }
    return { error: error.message || "Failed to update lead" };
  }
}

export async function convertLeadAction(id: string, profileId?: string) {
  // SECURITY: server actions are public endpoints; authorize every call.
  await verifyStaff();
  try {
    const lead = await crmService.convertLead(id, profileId);
    try {
      revalidatePath("/admin/crm/leads");
      revalidatePath("/admin/customers");
    } catch (revalErr) {
      console.warn("Revalidation warning:", revalErr);
    }
    return { data: lead };
  } catch (error: any) {
    console.error("[convertLeadAction] Error:", error);
    return { error: error?.message || "Failed to convert lead" };
  }
}

export async function getLeadNotesAction(leadId: string) {
  // SECURITY: server actions are public endpoints; authorize every call.
  await verifyStaff();
  try {
    const notes = await crmService.getLeadNotes(leadId);
    return { data: notes };
  } catch (error: any) {
    return { error: error.message };
  }
}

export async function addLeadNoteAction(leadId: string, content: string) {
  // SECURITY: server actions are public endpoints; authorize every call.
  await verifyStaff();
  try {
    const note = await crmService.addNoteToLead(leadId, content);
    revalidatePath("/admin/crm/leads");
    return { data: note };
  } catch (error: any) {
    return { error: error.message };
  }
}

export async function getLeadCommunicationLogsAction(leadId: string) {
  // SECURITY: server actions are public endpoints; authorize every call.
  await verifyStaff();
  try {
    const logs = await crmService.getLeadCommunicationLogs(leadId);
    return { data: logs };
  } catch (error: any) {
    return { error: error.message };
  }
}

export async function addCustomerNoteAction(profileId: string, data: unknown) {
  // SECURITY: server actions are public endpoints; authorize every call.
  await verifyStaff();
  try {
    const note = await crmService.addNoteToCustomer(profileId, data);
    try {
      revalidatePath(`/admin/customers/${profileId}`);
    } catch {}
    return { data: note };
  } catch (error: any) {
    return { error: error?.message || "Failed to add customer note" };
  }
}

export async function getCommunicationLogsAction() {
  // SECURITY: server actions are public endpoints; authorize every call.
  await verifyStaff();
  try {
    await cleanupFakeMessages();
    const logs = await crmService.getCommunicationLogs();
    return { data: logs };
  } catch (error: any) {
    return { error: error.message };
  }
}

export async function logCommunicationAction(data: {
  type: "EMAIL" | "SMS" | "IN_APP" | "PUSH" | "CALL" | "MEETING";
  direction: "INBOUND" | "OUTBOUND";
  subject?: string;
  content: string;
  lead_id?: string;
  profile_id?: string;
  created_at?: string;
}) {
  // SECURITY: server actions are public endpoints; authorize every call.
  await verifyStaff();
  try {
    const log = await crmService.logCommunication(data);
    revalidatePath("/admin/crm/messages");
    return { data: log };
  } catch (error: any) {
    return { error: error.message };
  }
}

export async function updateCommunicationLogAction(
  id: string,
  data: {
    type: "EMAIL" | "SMS" | "IN_APP" | "PUSH" | "CALL" | "MEETING";
    direction: "INBOUND" | "OUTBOUND";
    subject?: string;
    content: string;
    lead_id?: string;
    profile_id?: string;
    created_at?: string;
  }
) {
  // SECURITY: server actions are public endpoints; authorize every call.
  await verifyStaff();
  try {
    const log = await crmService.updateCommunicationLog(id, data);
    revalidatePath("/admin/crm/messages");
    return { data: log };
  } catch (error: any) {
    return { error: error.message || "Failed to update communication log" };
  }
}

export async function deleteCommunicationLogAction(id: string) {
  // SECURITY: server actions are public endpoints; authorize every call.
  await verifyStaff();
  try {
    await crmService.deleteCommunicationLog(id);
    revalidatePath("/admin/crm/messages");
    return { success: true };
  } catch (error: any) {
    return { error: error.message || "Failed to delete communication log" };
  }
}

