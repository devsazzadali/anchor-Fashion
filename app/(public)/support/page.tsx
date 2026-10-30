import type { Metadata } from "next";
import ContactPage from "../contact/page";

// REG-69: /support renders the contact experience but is its own route —
// it gets its own real title instead of the generic site default.
export const metadata: Metadata = {
  title: "Customer Support | Anchor Fashion",
  description:
    "Get help with orders, delivery, returns and more from the Anchor Fashion support team.",
};

export default function SupportPage() {
  return <ContactPage />;
}
