import { createAdminDbClient } from "@/lib/db/client";
import { prisma } from "@/lib/prisma";
import { BlogPost, BlogCategory, BlogTag } from "@/types/blog.types";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function resolveFeaturedImageForWrite(
  featuredImage: string | null | undefined,
  title?: string
): Promise<string | null> {
  if (!featuredImage) return null;
  const trimmed = featuredImage.trim();
  if (!trimmed) return null;

  if (UUID_REGEX.test(trimmed)) {
    return trimmed;
  }

  try {
    const admin = createAdminDbClient();
    const { data: existing } = await admin
      .from("cms_media")
      .select("id")
      .eq("file_url", trimmed)
      .limit(1)
      .maybeSingle();

    if (existing?.id) {
      return existing.id;
    }

    const fileName = title
      ? `${title.slice(0, 40).replace(/[^a-zA-Z0-9_-]/g, "_")}.avif`
      : "cover.avif";

    const { data: created, error: insertError } = await admin
      .from("cms_media")
      .insert({
        file_name: fileName,
        file_url: trimmed,
        file_type: "image/avif",
        file_size_bytes: 0,
      })
      .select("id")
      .single();

    if (created?.id) {
      return created.id;
    }
    if (insertError) {
      console.error("[resolveFeaturedImageForWrite insert error]:", insertError);
    }
  } catch (err) {
    console.error("[resolveFeaturedImageForWrite error]:", err);
  }

  return trimmed;
}

async function populateMediaUrls(posts: any[]): Promise<void> {
  if (!posts || posts.length === 0) return;

  const uuidMap = new Map<string, string>();
  const uuidsToFetch: string[] = [];

  for (const p of posts) {
    if (p.featured_image && UUID_REGEX.test(p.featured_image)) {
      uuidsToFetch.push(p.featured_image);
    }
  }

  if (uuidsToFetch.length > 0) {
    const uniqueUuids = Array.from(new Set(uuidsToFetch));
    try {
      const admin = createAdminDbClient();
      const { data: mediaItems } = await admin
        .from("cms_media")
        .select("id, file_url")
        .in("id", uniqueUuids);

      if (mediaItems) {
        for (const m of mediaItems) {
          if (m.file_url) uuidMap.set(m.id, m.file_url);
        }
      }
    } catch (err) {
      console.error("[populateMediaUrls error]:", err);
    }

    for (const p of posts) {
      if (p.featured_image && uuidMap.has(p.featured_image)) {
        p.featured_image = uuidMap.get(p.featured_image);
      }
    }
  }
}

/**
 * REG-83: attaches blog relations with batched Prisma reads.
 *
 * The fluent builder cannot attach embedded selects on blog_posts (the
 * old `blog_categories(*)` / `blog_post_tags(blog_tags(*))` selects were
 * silently dropped, so posts reached the storefront and admin without
 * their category or tags). The post rows still come from the builder;
 * the relations are resolved here with two indexed batch queries (no
 * N+1) and attached in the shapes consumers read: `blog_categories`
 * (single category object), `blog_post_tags` (join rows with the tag
 * nested) and `blog_tags` (flat tag list, the declared BlogPost type).
 */
async function attachBlogRelations(posts: any[], withTags: boolean): Promise<void> {
  if (!posts || posts.length === 0) return;

  const categoryIds = [...new Set(posts.map((p) => p.category_id).filter(Boolean))];
  const categoryById = new Map<string, BlogCategory>();
  if (categoryIds.length > 0) {
    const categories = await prisma.blogCategory.findMany({
      where: { id: { in: categoryIds as string[] } },
    });
    for (const c of categories) {
      categoryById.set(c.id, {
        id: c.id,
        name: c.name,
        slug: c.slug,
        description: c.description ?? null,
        created_at: c.createdAt,
        updated_at: c.createdAt,
      } as BlogCategory);
    }
  }
  for (const post of posts) {
    post.blog_categories = post.category_id
      ? categoryById.get(post.category_id) ?? null
      : null;
  }

  if (!withTags) return;

  const postIds = posts.map((p) => p.id).filter(Boolean);
  const joins = postIds.length
    ? await (prisma as any).blog_post_tags.findMany({
        where: { post_id: { in: postIds } },
      })
    : [];
  const tagIds = [...new Set(joins.map((j: any) => j.tag_id).filter(Boolean))];
  const tagById = new Map<string, BlogTag>();
  if (tagIds.length > 0) {
    const tags = await (prisma as any).blog_tags.findMany({
      where: { id: { in: tagIds } },
    });
    for (const t of tags) {
      tagById.set(t.id, {
        id: t.id,
        name: t.name,
        slug: t.slug,
        created_at: t.created_at,
      } as BlogTag);
    }
  }
  const joinsByPost = new Map<string, any[]>();
  for (const j of joins) {
    if (!joinsByPost.has(j.post_id)) joinsByPost.set(j.post_id, []);
    joinsByPost.get(j.post_id)!.push({
      post_id: j.post_id,
      tag_id: j.tag_id,
      blog_tags: tagById.get(j.tag_id) ?? null,
    });
  }
  for (const post of posts) {
    const postJoins = joinsByPost.get(post.id) || [];
    post.blog_post_tags = postJoins;
    post.blog_tags = postJoins
      .map((j: any) => j.blog_tags)
      .filter((t: any): t is BlogTag => !!t);
  }
}

export class BlogRepository {
  async getPosts(status?: string): Promise<BlogPost[]> {
    const admin = createAdminDbClient();
    let query = admin
      .from("blog_posts")
      .select("*")
      .order("created_at", { ascending: false });

    if (status) {
      query = query.eq("status", status);
    }

    const { data, error } = await query;
    if (error) {
      console.error("[BlogRepository.getPosts Error]:", error);
      throw new Error(error.message);
    }
    if (data && data.length > 0) {
      await attachBlogRelations(data, false);
      await populateMediaUrls(data);
    }
    return data || [];
  }

  async getPostBySlug(slug: string): Promise<BlogPost | null> {
    const admin = createAdminDbClient();
    const { data, error } = await admin
      .from("blog_posts")
      .select("*")
      .eq("slug", slug)
      .single();

    if (error) {
      if (error.code === "PGRST116") return null;
      console.error("[BlogRepository.getPostBySlug Error]:", error);
      throw new Error(error.message);
    }
    if (data) {
      await attachBlogRelations([data], true);
      await populateMediaUrls([data]);
    }
    return data;
  }

  async getPostById(id: string): Promise<BlogPost | null> {
    const admin = createAdminDbClient();
    const { data, error } = await admin
      .from("blog_posts")
      .select("*")
      .eq("id", id)
      .single();

    if (error) {
      if (error.code === "PGRST116") return null;
      console.error("[BlogRepository.getPostById Error]:", error);
      throw new Error(error.message);
    }
    if (data) {
      await attachBlogRelations([data], true);
      await populateMediaUrls([data]);
    }
    return data;
  }

  async createPost(post: Partial<BlogPost>): Promise<BlogPost> {
    const admin = createAdminDbClient();

    const cleanedPost: any = { ...post };
    if (cleanedPost.category_id !== undefined) {
      if (!cleanedPost.category_id || !UUID_REGEX.test(cleanedPost.category_id)) {
        cleanedPost.category_id = null;
      }
    }

    if (cleanedPost.featured_image) {
      const resolvedMediaId = await resolveFeaturedImageForWrite(
        cleanedPost.featured_image,
        cleanedPost.title
      );
      if (resolvedMediaId) {
        cleanedPost.featured_image = resolvedMediaId;
      }
    } else {
      cleanedPost.featured_image = null;
    }

    const { data, error } = await admin
      .from("blog_posts")
      .insert(cleanedPost)
      .select()
      .single();

    if (error) throw new Error(error.message);
    if (data) await populateMediaUrls([data]);
    return data;
  }

  async updatePost(id: string, updates: Partial<BlogPost>): Promise<BlogPost> {
    const admin = createAdminDbClient();

    const cleanedUpdates: any = { ...updates };
    if (cleanedUpdates.category_id !== undefined) {
      if (!cleanedUpdates.category_id || !UUID_REGEX.test(cleanedUpdates.category_id)) {
        cleanedUpdates.category_id = null;
      }
    }

    if (cleanedUpdates.featured_image !== undefined) {
      if (cleanedUpdates.featured_image) {
        const resolvedMediaId = await resolveFeaturedImageForWrite(
          cleanedUpdates.featured_image,
          cleanedUpdates.title
        );
        if (resolvedMediaId) {
          cleanedUpdates.featured_image = resolvedMediaId;
        }
      } else {
        cleanedUpdates.featured_image = null;
      }
    }

    const { data, error } = await admin
      .from("blog_posts")
      .update(cleanedUpdates)
      .eq("id", id)
      .select()
      .single();

    if (error) throw new Error(error.message);
    if (data) await populateMediaUrls([data]);
    return data;
  }

  async deletePost(id: string): Promise<void> {
    const admin = createAdminDbClient();
    try {
      await admin.from("blog_post_tags").delete().eq("post_id", id);
    } catch {}
    const { error } = await admin.from("blog_posts").delete().eq("id", id);
    if (error) throw new Error(error.message);
  }

  async getCategories(): Promise<BlogCategory[]> {
    const admin = createAdminDbClient();
    const { data, error } = await admin
      .from("blog_categories")
      .select("*")
      .order("name");
    if (error) {
      console.error("[BlogRepository.getCategories Error]:", error);
      throw new Error(error.message);
    }
    return data || [];
  }

  async getTags(): Promise<BlogTag[]> {
    const admin = createAdminDbClient();
    const { data, error } = await admin
      .from("blog_tags")
      .select("*")
      .order("name");
    if (error) {
      console.error("[BlogRepository.getTags Error]:", error);
      throw new Error(error.message);
    }
    return data || [];
  }
}
