import { prisma } from "@/lib/prisma";

export class TagRepository {
  static async getTags() {
    try {
      const tags = await prisma.tag.findMany({
        orderBy: { name: "asc" },
      });
      return tags;
    } catch (err) {
      return [];
    }
  }
}
