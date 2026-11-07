/**
 * File storage (lib/db).
 *
 * Workstream G storage routing: Vercel Blob when STORAGE_DRIVER=
 * vercel-blob + BLOB_READ_WRITE_TOKEN are set (the DB then stores the
 * absolute Blob URL, returned here as data.path), otherwise the local
 * disk under public/uploads with the legacy /uploads URL shape.
 * Uploads are restricted to a safe extension allow-list either way.
 *
 * ⚠️ This shim is reachable from client bundles (via lib/db/client), so
 * it must never import lib/storage/driver (node builtins — Turbopack
 * fails the build across that edge). The Blob branch uses the fs-free
 * lib/storage/blob.ts (dynamic import); the disk branch uses the
 * original inline dynamic fs import pattern. All real callers are
 * server-side.
 */
const ALLOWED_UPLOAD_EXT = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".gif",
  ".avif",
  ".mp4",
  ".webm",
  ".pdf",
]);

export const dbStorage = {
  from: (bucket: string) => ({
    upload: async (path: string, file: any, opts?: any) => {
      try {
        if (typeof window !== "undefined" || !file) {
          return { data: { path }, error: null };
        }
        // Normalize the payload to a Buffer once (shared by both drivers).
        let buffer: Buffer;
        if (Buffer.isBuffer(file)) {
          buffer = file;
        } else if (
          file instanceof Blob ||
          typeof file?.arrayBuffer === "function"
        ) {
          const ab = await file.arrayBuffer();
          buffer = Buffer.from(ab);
        } else if (typeof file === "string") {
          buffer = Buffer.from(file, "base64");
        } else {
          buffer = Buffer.from(String(file));
        }
        const extCheck = String(path).split(".").pop()?.toLowerCase() || "";
        if (!ALLOWED_UPLOAD_EXT.has(`.${extCheck}`)) {
          throw new Error("File type not allowed");
        }
        const { isBlobStorageEnabled, putToBlob } = await import(
          "@/lib/storage/blob"
        );
        if (isBlobStorageEnabled()) {
          const url = await putToBlob(
            `${bucket}/${path}`,
            buffer,
            opts?.contentType
          );
          // data.path carries the absolute Blob URL in blob mode; callers
          // persist it directly (see cms media / avatar / return-proof).
          return { data: { path: url, url }, error: null };
        }
        // Disk mode (local dev): legacy layout — file lands at
        // public/uploads/<path> and callers resolve it via getPublicUrl.
        {
          const fs = await import("fs/promises");
          const pathModule = await import("path");
          // SECURITY: confine writes to public/uploads, safe extensions only.
          const uploadsRoot = pathModule.resolve(
            process.cwd(),
            "public",
            "uploads"
          );
          const cleanSegments = String(path)
            .replace(/\\/g, "/")
            .split("/")
            .map((seg) => seg.replace(/[^a-zA-Z0-9._-]/g, ""))
            .filter((seg) => seg && seg !== "." && seg !== "..");
          if (cleanSegments.length === 0) {
            throw new Error("Invalid upload path");
          }
          const dest = pathModule.resolve(uploadsRoot, ...cleanSegments);
          if (!dest.startsWith(uploadsRoot + pathModule.sep)) {
            throw new Error("Invalid upload path");
          }
          await fs.mkdir(pathModule.dirname(dest), { recursive: true });
          await fs.writeFile(dest, buffer);
        }
        return { data: { path }, error: null };
      } catch (err: any) {
        console.error("[polyfill storage.upload error]:", err);
        return { data: null, error: err };
      }
    },
    getPublicUrl: (path: string) => ({
      data: {
        publicUrl:
          path?.startsWith("http") ||
          path?.startsWith("data:") ||
          path?.startsWith("blob:")
            ? path
            : `/uploads/${path?.replace(/^\/+/, "")}`,
      },
    }),
    download: async (path: string) => ({ data: new Blob(), error: null }),
    remove: async (paths: string[]) => {
      // Real delete (was a no-op stub): Blob objects in blob mode via
      // lib/storage/blob, disk files in disk mode via inline fs.
      try {
        const { isBlobStorageEnabled, deleteFromBlob } = await import(
          "@/lib/storage/blob"
        );
        if (isBlobStorageEnabled()) {
          for (const p of paths || []) {
            await deleteFromBlob(
              /^https?:\/\//.test(p) ? p : `${bucket}/${p}`
            );
          }
        } else if (typeof window === "undefined") {
          const fs = await import("fs/promises");
          const pathModule = await import("path");
          const uploadsRoot = pathModule.resolve(
            process.cwd(),
            "public",
            "uploads"
          );
          for (const p of paths || []) {
            const rel = p.startsWith("/uploads/")
              ? p.slice("/uploads/".length)
              : p;
            const dest = pathModule.resolve(uploadsRoot, rel);
            if (dest.startsWith(uploadsRoot + pathModule.sep)) {
              await fs.unlink(dest).catch(() => {});
            }
          }
        }
      } catch {}
      return { data: paths, error: null };
    },
    list: async (folder?: string, opts?: any) => ({
      data: [],
      error: null,
    }),
    createSignedUrl: async (path: string, exp: number) => ({
      data: {
        signedUrl: path?.startsWith("http")
          ? path
          : `/uploads/${path?.replace(/^\/+/, "")}`,
      },
      error: null,
    }),
  }),
  listBuckets: async () => ({
    data: [{ name: "media" }, { name: "return_proofs" }],
    error: null,
  }),
  getBucket: async (name: string) => ({ data: { name }, error: null }),
  createBucket: async (name: string, opts?: any) => ({
    data: { name },
    error: null,
  }),
  deleteBucket: async (name: string) => ({ data: null, error: null }),
};
