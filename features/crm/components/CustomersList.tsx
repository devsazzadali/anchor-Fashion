import React from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { TierBadge, LoyaltyTier } from "@/components/customer/loyalty/tier-badges";
import { tierTitleCase } from "@/lib/loyalty/tiers";
import { CustomerAdminActions } from "./CustomerAdminActions";

export type CustomerLifecycleStage =
  | "PROSPECT"
  | "FIRST_TIME_BUYER"
  | "REPEAT_CUSTOMER"
  | "LOYAL"
  | "AT_RISK"
  | "CHURNED";

export interface CrmCustomer {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone?: string;
  assigned_password?: string | null;
  is_vip: boolean;
  /** S6-2: real loyalty tier from the canonical ladder (lib/loyalty/tiers). */
  loyalty_tier?: string;
  loyalty_points?: number;
  customer_lifecycle_stage: CustomerLifecycleStage;
  health_score: number;
  total_support_tickets: number;
  last_interaction_at: string;
}

interface CustomersListProps {
  customers?: CrmCustomer[];
  isAdmin?: boolean;
}

export const CustomersList = ({
  customers = [],
  isAdmin = false,
}: CustomersListProps) => {
  return (
    <div className="rounded-md border bg-card">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Customer</TableHead>
              <TableHead>Loyalty & Tags</TableHead>
              <TableHead>Lifecycle Stage</TableHead>
              <TableHead className="text-right">Health Score</TableHead>
              {isAdmin && <TableHead className="text-right">Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {customers.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={isAdmin ? 5 : 4}
                  className="py-6 text-center text-muted-foreground"
                >
                  No customers found.
                </TableCell>
              </TableRow>
            ) : (
              customers.map((customer) => (
                <TableRow key={customer.id}>
                  <TableCell>
                    <div className="font-medium">
                      {customer.first_name} {customer.last_name}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {customer.email}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-2 items-start">
                      {/* S6-2: badge = the customer's real loyalty tier
                          from the canonical ladder. The old rule
                          (spend > ৳5,000 → "Platinum", else a
                          health-score guess) labelled a 57-point
                          customer PLATINUM while his detail page and
                          the tiers tab said Silver. */}
                      <TierBadge
                        tier={tierTitleCase(
                          customer.loyalty_tier || "SILVER"
                        ) as LoyaltyTier}
                      />
                      <div className="flex gap-1 flex-wrap">
                        <span className="text-[9px] uppercase tracking-widest font-bold bg-gray-100 px-1.5 py-0.5 rounded text-gray-500">
                          {customer.total_support_tickets > 2 ? "High Touch" : "Self Service"}
                        </span>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="capitalize">
                      {customer.customer_lifecycle_stage
                        .replace(/_/g, " ")
                        .toLowerCase()}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <span
                      className={`font-semibold ${customer.health_score > 75 ? "text-green-600" : customer.health_score < 50 ? "text-red-600" : "text-yellow-600"}`}
                    >
                      {customer.health_score}/100
                    </span>
                  </TableCell>
                  {isAdmin && (
                    <TableCell className="text-right">
                      <CustomerAdminActions customer={customer} />
                    </TableCell>
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
};
