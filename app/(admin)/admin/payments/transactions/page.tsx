import { prisma } from "@/lib/prisma";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

export const revalidate = 0;

/**
 * S6-7: this page read a `payment_transactions` table that does not
 * exist in the schema (the polyfill resolved it to an empty result, so
 * the page rendered "No transactions found" forever — even the error
 * branch never fired). It now reads the real `payments` ledger via
 * Prisma, joined to its order. Rows are written at order placement and
 * flipped to SUCCESS when the order is paid (see
 * lib/payments/order-payment-record). Legacy POS rows carry status
 * COMPLETED — both SUCCESS and COMPLETED render as paid.
 */
export default async function TransactionsPage() {
  const transactions = await prisma.payment.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      order: { select: { orderNumber: true } },
    },
  });

  const statusVariant = (status: string) => {
    const s = status.toUpperCase();
    if (s === "SUCCESS" || s === "COMPLETED") return "default" as const;
    if (s === "FAILED") return "destructive" as const;
    return "secondary" as const;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Transactions</h1>
      </div>

      <div className="rounded-md border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Reference</TableHead>
              <TableHead>Order</TableHead>
              <TableHead>Method</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Date</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {transactions.map((txn) => (
              <TableRow key={txn.id}>
                <TableCell className="font-mono text-xs">
                  {txn.transactionId || txn.id}
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {txn.order?.orderNumber || txn.orderId}
                </TableCell>
                <TableCell>{txn.method}</TableCell>
                <TableCell>৳{Number(txn.amount).toFixed(2)} BDT</TableCell>
                <TableCell>
                  <Badge variant={statusVariant(txn.status)}>
                    {txn.status}
                  </Badge>
                </TableCell>
                <TableCell>
                  {new Date(txn.createdAt).toLocaleString()}
                </TableCell>
              </TableRow>
            ))}
            {transactions.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center">
                  No transactions found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
