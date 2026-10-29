import { Metadata } from "next";
import {
  getFeaturesBarConfig,
  getHomepageLayout,
} from "@/lib/actions/homepage.actions";
import HomepageManagerClient from "./HomepageManagerClient";

export const metadata: Metadata = {
  title: "Homepage Manager | CMS Admin",
  description:
    "Control homepage section visibility, ordering, and the features bar",
};

export default async function HomepageManagerPage() {
  const [layout, features] = await Promise.all([
    getHomepageLayout(),
    getFeaturesBarConfig(),
  ]);
  return (
    <HomepageManagerClient initialLayout={layout} initialFeatures={features} />
  );
}
