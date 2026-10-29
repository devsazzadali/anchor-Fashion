/**
 * Media storage driver (Workstream G — owner decision 2026-10-29).
 *
 * SINGLE CHOKE POINT for every admin-managed media upload. Media files
 * must NOT live in the git repo or (in production) on the app server's
 * disk: they go to object storage and the DATABASE stores only the URL.
 *
 *  - Production: `STORAGE_DRIVER=vercel-blob` + `BLOB_READ_WRITE_TOKEN`
 *    → files are stored in Vercel Blob, the returned absolute public
 *    URL is what gets persisted.
 *  - Local dev (default): files are written under `public/uploads/` and
 *    the `/uploads/...` path is persisted — local testing keeps working
 *    end-to-end with zero extra setup.
 *
 * ⚠️ SERVER-ONLY module: it imports node builtins statically, so it may
 * only be imported from server-side code (server actions, route
 * handlers). The lib/db storage shim — which is reachable from client
 * bundles — uses lib/storage/blob.ts + its own inline disk code instead;
 * never import this file from lib/db/*.
 */
import path from "path";
import fs from "fs/promises";
import {
  isBlobStorageEnabled,
  putToBlob,
  deleteFromBlob,
} from "@/lib/storage/blob";

export { isBlobStorageEnabled };

function sanitizePathname(pathname: string): string {
  const clean = String(pathname)
    .replace(/\\/g, "/")
    .split("/")
    .map((seg) => seg.replace(/[^a-zA-Z0-9._-]/g, ""))
    .filter((seg) => seg && seg !== "." && seg !== "..")
    .join("/");
  if (!clean) throw new Error("Invalid upload pathname");
  return clean;
}

export interface StoredFile {
  /** Absolute Blob URL in blob mode; `/uploads/...` path in disk mode. */
  url: string;
  pathname: string;
  driver: "vercel-blob" | "disk";
}

export async function storeUploadedFile(
  pathname: string,
  body: Buffer,
  contentType?: string
): Promise<StoredFile> {
  const clean = sanitizePathname(pathname);

  if (isBlobStorageEnabled()) {
    const url = await putToBlob(clean, body, contentType);
    return { url, pathname: clean, driver: "vercel-blob" };
  }

  const uploadsRoot = path.resolve(process.cwd(), "public", "uploads");
  const dest = path.resolve(uploadsRoot, clean);
  if (!dest.startsWith(uploadsRoot + path.sep)) {
    throw new Error("Invalid upload pathname");
  }
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, body);
  return { url: `/uploads/${clean}`, pathname: clean, driver: "disk" };
}

/**
 * Best-effort delete of a previously stored file. Accepts an absolute
 * Blob URL, a `/uploads/...` public path, or a bare logical pathname
 * (optionally prefixed with its bucket/folder). Never throws.
 */
export async function deleteUploadedFile(
  urlOrPath: string,
  bucket?: string
): Promise<void> {
  try {
    if (!urlOrPath) return;
    if (isBlobStorageEnabled()) {
      if (/^https?:\/\//.test(urlOrPath)) {
        await deleteFromBlob(urlOrPath);
      } else {
        await deleteFromBlob(bucket ? `${bucket}/${urlOrPath}` : urlOrPath);
      }
      return;
    }
    const rel = urlOrPath.startsWith("/uploads/")
      ? urlOrPath.slice("/uploads/".length)
      : urlOrPath;
    const uploadsRoot = path.resolve(process.cwd(), "public", "uploads");
    const dest = path.resolve(uploadsRoot, rel);
    if (dest.startsWith(uploadsRoot + path.sep)) {
      await fs.unlink(dest).catch(() => {});
    }
  } catch (err) {
    console.warn("[storage] deleteUploadedFile failed (non-fatal):", err);
  }
}
