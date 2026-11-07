/**
 * Vercel Blob primitives (Workstream G).
 *
 * This module intentionally contains NO node builtins (fs/path) — not
 * even dynamic imports — because it is imported (dynamically) by
 * lib/db/storage.ts, which is reachable from client bundles; Turbopack
 * resolves modules across that edge for the browser and any fs/path
 * reference fails the build. The @vercel/blob SDK is fetch-based and
 * browser-resolvable.
 */

export function isBlobStorageEnabled(): boolean {
  return (
    process.env.STORAGE_DRIVER === "vercel-blob" &&
    !!process.env.BLOB_READ_WRITE_TOKEN
  );
}

/** Uploads to the Blob store; returns the absolute public URL. */
export async function putToBlob(
  pathname: string,
  body: Buffer,
  contentType?: string
): Promise<string> {
  const { put } = await import("@vercel/blob");
  const blob = await put(pathname, body, {
    access: "public",
    contentType,
    token: process.env.BLOB_READ_WRITE_TOKEN,
    addRandomSuffix: false,
  });
  return blob.url;
}

/** Best-effort Blob delete by absolute URL or store pathname. */
export async function deleteFromBlob(urlOrPathname: string): Promise<void> {
  try {
    const { del } = await import("@vercel/blob");
    await del(urlOrPathname, { token: process.env.BLOB_READ_WRITE_TOKEN });
  } catch (err) {
    console.warn("[storage] Blob delete failed (non-fatal):", err);
  }
}
