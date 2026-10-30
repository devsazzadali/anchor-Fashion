import type { Metadata } from "next";
import type { ReactNode } from "react";

// REG-69: the track-order page is a client component and cannot export
// metadata, so it inherited the generic site default title. The segment
// layout carries its real title instead.
export const metadata: Metadata = {
  title: "Track Your Order | Anchor Fashion",
  description:
    "Track the delivery status of your Anchor Fashion order in real time.",
};

export default function TrackOrderLayout({
  children,
}: {
  children: ReactNode;
}) {
  return <>{children}</>;
}
