import { prisma } from "@/lib/prisma";

export class CustomerSegmentRepository {
  static async getSegments() {
    const segments = await prisma.customerGroup.findMany({
      orderBy: { createdAt: "desc" },
    });

    return Promise.all(
      segments.map(async (segment) => {
        const member_count = await prisma.customer_segment_members.count({
          where: { segment_id: segment.id },
        });

        return {
          id: segment.id,
          name: segment.name,
          description: segment.description ?? null,
          is_dynamic: segment.isDynamic,
          member_count,
          created_at: segment.createdAt
            ? new Date(segment.createdAt).toISOString()
            : new Date().toISOString(),
          updated_at: segment.updatedAt
            ? new Date(segment.updatedAt).toISOString()
            : new Date().toISOString(),
        };
      })
    );
  }
}
