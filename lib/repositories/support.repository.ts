import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  SupportTicket,
  TicketMessage,
} from "@/types/support.types";

type SupportTicketRow = Prisma.SupportTicketGetPayload<object> & {
  // Defensive legacy read in mapPrismaTicket: the SupportTicket model
  // has no resolvedAt column, so this is always undefined on Prisma rows.
  resolvedAt?: Date | null;
};

type TicketMessageRow = Prisma.TicketMessageGetPayload<object>;

export class SupportRepository {
  async getTickets(): Promise<SupportTicket[]> {
    const data = await prisma.supportTicket.findMany({
      orderBy: { createdAt: "desc" },
    });
    return data.map(mapPrismaTicket) as SupportTicket[];
  }

  async getTicketById(id: string): Promise<SupportTicket> {
    const data = await prisma.supportTicket.findUnique({
      where: { id },
    });
    if (!data) throw new Error("Ticket not found");
    return mapPrismaTicket(data) as SupportTicket;
  }

  async createTicket(
    ticket: Partial<SupportTicket> & { customer_id?: string | null }
  ): Promise<SupportTicket> {
    const data = await prisma.supportTicket.create({
      data: {
        id: ticket.id,
        ticketNumber: String(ticket.ticket_number || `TKT-${Date.now()}`),
        customerId: ticket.customer_id,
        subject: ticket.subject || "No subject",
        description: ticket.description || "",
        status: ticket.status || "OPEN",
        priority: ticket.priority || "MEDIUM",
        assignedAgentId: ticket.assigned_agent_id,
        category: ticket.category || "GENERAL",
      },
    });
    return mapPrismaTicket(data) as SupportTicket;
  }

  async updateTicket(
    id: string,
    updates: Partial<SupportTicket>
  ): Promise<SupportTicket> {
    const data = await prisma.supportTicket.update({
      where: { id },
      data: {
        status: updates.status,
        priority: updates.priority,
        assignedAgentId: updates.assigned_agent_id,
      },
    });
    return mapPrismaTicket(data) as SupportTicket;
  }

  async getMessages(ticketId: string): Promise<TicketMessage[]> {
    const data = await prisma.ticketMessage.findMany({
      where: { ticketId },
      orderBy: { createdAt: "asc" },
    });
    return data.map(mapPrismaMessage) as TicketMessage[];
  }

  async addMessage(
    message: Partial<TicketMessage> & {
      body?: string;
      is_internal?: boolean;
      isInternal?: boolean;
    }
  ): Promise<TicketMessage> {
    const data = await prisma.ticketMessage.create({
      data: {
        id: message.id,
        ticketId: message.ticket_id!,
        senderId: message.sender_id!,
        senderType: message.sender_type || "CUSTOMER",
        body: message.body || message.message || "",
        isInternal: message.is_internal ?? message.isInternal ?? false,
      },
    });
    return mapPrismaMessage(data) as TicketMessage;
  }
}

// REG-65 holdout: both mapper RETURNS stay `any`. The precise mapped
// shapes conflict with types/support.types — SupportTicket declares
// ticket_number: number (the column is a string) and TicketMessage
// requires message / is_internal_note / updated_at, which these mappers
// never produce — so the call-site `as SupportTicket[]` /
// `as TicketMessage[]` casts stop being comparable (TS2352) the moment
// the returns are typed. Reconciling the two type universes is out of
// scope for a type-only batch (Batch-2 precedent, same types file).
function mapPrismaTicket(data: SupportTicketRow): any {
  return {
    ...data,
    ticket_number: data.ticketNumber,
    customer_id: data.customerId,
    assigned_agent_id: data.assignedAgentId,
    resolved_at: data.resolvedAt?.toISOString(),
    created_at: data.createdAt.toISOString(),
    updated_at: data.updatedAt.toISOString(),
  };
}

function mapPrismaMessage(data: TicketMessageRow): any {
  return {
    ...data,
    ticket_id: data.ticketId,
    sender_id: data.senderId,
    sender_type: data.senderType,
    is_internal: data.isInternal,
    created_at: data.createdAt.toISOString(),
  };
}
