import { Button } from "@/components/ui/button";
import { FileText } from "lucide-react";
import Link from "next/link";

export function CustomerOrderInvoiceButton({ order }: { order: any }) {
  return (
    <Button
      variant="outline"
      size="sm"
      className="gap-1.5"
      asChild
    >
      <Link href={`/account/orders/${order.id}/invoice`} target="_blank">
        <FileText className="h-4 w-4" />
        View Invoice
      </Link>
    </Button>
  );
}
