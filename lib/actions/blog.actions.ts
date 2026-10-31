"use server";

import { blogService } from "@/services/blog.service";
import { BlogPost, BlogCategory, BlogTag } from "@/types/blog.types";
import { revalidatePath } from "next/cache";
import { createDbClient } from "@/lib/db/client";
import { createAdminDbClient } from "@/lib/db/client";
import { verifyStaff } from "@/lib/security/roles";

export async function getPosts(status?: string): Promise<BlogPost[]> {
  try {
    // SECURITY: server actions are public endpoints. Only the published list
    // is public; any other status (or the unfiltered all-statuses list used
    // by the admin/manager CMS) requires a staff session, otherwise drafts
    // would be enumerable anonymously.
    if (String(status || "").toLowerCase() !== "published") {
      await verifyStaff();
    }
    return await blogService.getPosts(status);
  } catch (error) {
    console.error("[getPosts Error]:", error);
    return [];
  }
}

export async function getPostBySlug(slug: string): Promise<BlogPost | null> {
  try {
    return await blogService.getPostBySlug(slug);
  } catch (error) {
    console.error("[getPostBySlug Error]:", error);
    return null;
  }
}

export async function getPostById(id: string): Promise<BlogPost | null> {
  try {
    // SECURITY: only consumer is the admin CMS edit page; by-id reads can
    // fetch unpublished drafts, so require staff (fails closed to null).
    await verifyStaff();
    return await blogService.getPostById(id);
  } catch (error) {
    console.error("[getPostById Error]:", error);
    return null;
  }
}

export async function createPost(data: unknown): Promise<BlogPost> {
  // SECURITY: server actions are public endpoints; authorize every call.
  await verifyStaff();
  let authorId = (data as any)?.author_id;

  try {
    const db = await createDbClient();
    const {
      data: { user },
    } = await db.auth.getUser();

    if (!authorId || authorId === "00000000-0000-0000-0000-000000000000") {
      authorId = user?.id;
    }
  } catch {
    // Session not active
  }

  if (!authorId) {
    try {
      const admin = createAdminDbClient();
      const { data: profile } = await admin
        .from("profiles")
        .select("id")
        .limit(1)
        .maybeSingle();
      authorId = profile?.id;
    } catch {
      // Ignore if profiles table is empty
    }
  }

  const postData = {
    ...(data as any),
    ...(authorId ? { author_id: authorId } : {}),
  };

  const post = await blogService.createPost(postData);
  try {
    revalidatePath("/admin/cms/blogs");
    revalidatePath("/blog");
  } catch {}
  return post;
}

export async function updatePost(id: string, data: unknown): Promise<BlogPost> {
  // SECURITY: server actions are public endpoints; authorize every call.
  await verifyStaff();
  const post = await blogService.updatePost(id, data);
  try {
    revalidatePath("/admin/cms/blogs");
    revalidatePath("/blog");
    if (post?.slug) {
      revalidatePath(`/blog/${post.slug}`);
    }
  } catch {}
  return post;
}

export async function deletePost(id: string): Promise<void> {
  // SECURITY: server actions are public endpoints; authorize every call.
  await verifyStaff();
  await blogService.deletePost(id);
  try {
    revalidatePath("/admin/cms/blogs");
    revalidatePath("/blog");
  } catch {}
}

export async function getCategories(): Promise<BlogCategory[]> {
  try {
    return await blogService.getCategories();
  } catch (error) {
    console.error("[getCategories Error]:", error);
    return [];
  }
}

export async function getTags(): Promise<BlogTag[]> {
  try {
    return await blogService.getTags();
  } catch (error) {
    console.error("[getTags Error]:", error);
    return [];
  }
}
