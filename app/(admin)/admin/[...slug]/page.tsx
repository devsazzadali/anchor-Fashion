import { notFound } from "next/navigation";

/**
 * Unknown /admin/* paths are a real 404.
 *
 * This catch-all previously rendered a friendly "Page Under
 * Construction" placeholder with HTTP 200, which silently absorbed
 * every dead link in the admin (three broken sidebar links survived
 * unnoticed until the Phase 3 nav audit because of it). A 404 surfaces
 * broken links immediately instead of masking them.
 */
export default function AdminCatchAllPage() {
  notFound();
}
