/**
 * File storage (lib/db).
 *
 * The project stores uploads on the application server under
 * public/uploads. Uploads are confined to that directory and restricted
 * to a safe extension allow-list; public URLs are served from /uploads.
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
        if (typeof window === "undefined" && file) {
          const fs = await import("fs/promises");
          const pathModule = await import("path");
          // SECURITY: confine writes to public/uploads and allow only safe extensions.
          const uploadsRoot = pathModule.resolve(process.cwd(), "public", "uploads");
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
          const ext = pathModule.extname(dest).toLowerCase();
          if (!ALLOWED_UPLOAD_EXT.has(ext)) {
            throw new Error("File type not allowed");
          }
          await fs.mkdir(pathModule.dirname(dest), { recursive: true });

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
    remove: async (paths: string[]) => ({ data: paths, error: null }),
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
