import { Metadata } from "next";
import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth/server";
import { WalletService } from "@/services/wallet.service";
import { Wallet as WalletIcon, ArrowDownLeft, ArrowUpRight } from "lucide-react";

export const metadata: Metadata = {
  title: "My Wallet | Anchor Fashion",
  description: "Your Anchor Fashion wallet balance and transaction history.",
};

export const dynamic = "force-dynamic";

function formatMoney(value: number | string, currency = "BDT"): string {
  const n = Number(value) || 0;
  return `${currency === "BDT" ? "৳" : currency + " "}${n.toLocaleString(
    "en-BD",
    { minimumFractionDigits: 2, maximumFractionDigits: 2 }
  )}`;
}

export default async function WalletPage() {
  const { user } = await getServerSession();

  if (!user) {
    redirect("/auth/login?next=/account/wallet");
  }

  let wallet = null;
  let transactions: any[] = [];
  let loadError = false;
  try {
    wallet = await WalletService.getWallet(user.id);
    if (wallet) {
      transactions = await WalletService.getTransactions(wallet.id);
    }
  } catch (err) {
    console.error("Error loading wallet:", err);
    loadError = true;
  }

  return (
    <div>
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#0C2254] text-white">
          <WalletIcon className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-900">My Wallet</h1>
          <p className="text-sm text-slate-500">
            Balance and transaction history for your Anchor Fashion wallet.
          </p>
        </div>
      </div>

      {loadError || !wallet ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center">
          <p className="font-medium text-red-700">
            We couldn&apos;t load your wallet right now.
          </p>
          <p className="mt-1 text-sm text-red-500">
            Please refresh the page or try again in a few minutes.
          </p>
        </div>
      ) : (
        <>
          <div className="mb-8 rounded-2xl bg-[#0C2254] p-6 text-white shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wider text-white/70">
              Available balance
            </p>
            <p className="mt-1 text-3xl font-bold">
              {formatMoney(wallet.balance, wallet.currency)}
            </p>
            <p className="mt-3 text-sm text-white/70">
              Wallet credit is added by Anchor Fashion — for example when a
              refund is issued to your wallet. Online top-up is not available
              yet.
            </p>
          </div>

          <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-slate-900">
            Transaction history
          </h2>
          {transactions.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-6 py-10 text-center">
              <WalletIcon className="mx-auto mb-3 h-8 w-8 text-slate-300" />
              <p className="font-medium text-slate-700">No transactions yet</p>
              <p className="mt-1 text-sm text-slate-500">
                When wallet credit is added or spent, it will appear here.
              </p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border">
              <ul className="divide-y divide-slate-100">
                {transactions.map((tx: any) => {
                  const isCredit = tx.type === "CREDIT";
                  return (
                    <li
                      key={tx.id}
                      className="flex items-center gap-4 px-4 py-3"
                    >
                      <span
                        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
                          isCredit
                            ? "bg-green-100 text-green-700"
                            : "bg-red-100 text-red-700"
                        }`}
                      >
                        {isCredit ? (
                          <ArrowDownLeft className="h-4 w-4" />
                        ) : (
                          <ArrowUpRight className="h-4 w-4" />
                        )}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-slate-800">
                          {tx.description ||
                            (isCredit ? "Wallet credit" : "Wallet payment")}
                        </p>
                        <p className="text-xs text-slate-400">
                          {new Date(tx.created_at).toLocaleDateString(
                            "en-BD",
                            {
                              year: "numeric",
                              month: "short",
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            }
                          )}
                        </p>
                      </div>
                      <div className="text-right">
                        <p
                          className={`text-sm font-semibold ${
                            isCredit ? "text-green-700" : "text-red-700"
                          }`}
                        >
                          {isCredit ? "+" : "−"}
                          {formatMoney(tx.amount, wallet.currency)}
                        </p>
                        <p className="text-xs text-slate-400">
                          Balance:{" "}
                          {formatMoney(tx.balance_after, wallet.currency)}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
