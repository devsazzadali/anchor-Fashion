"use client";

import type { UseFormReturn } from "react-hook-form";
import { CreditCard, Landmark, Loader2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { ManualPaymentFields } from "@/components/checkout/manual-payment-fields";
import type { AllPaymentConfigs } from "@/lib/actions/payment.actions";
import type {
  CheckoutFormValues,
  CheckoutPaymentFormValues,
} from "@/schemas/checkout.schema";
import type { CheckoutStep } from "@/types/checkout.types";

export interface CheckoutPaymentStepProps {
  form: UseFormReturn<CheckoutFormValues>;
  activeStep: string;
  paymentConfigs?: AllPaymentConfigs;
  setPayment: (data: CheckoutPaymentFormValues) => void;
  updateStep: (step: CheckoutStep) => Promise<void>;
  isSubmitting: boolean;
}

export function CheckoutPaymentStep({
  form,
  activeStep,
  paymentConfigs,
  setPayment,
  updateStep,
  isSubmitting,
}: CheckoutPaymentStepProps) {
  return (
    <>
        {/* Step 3: Payment */}
        <div
          className={`space-y-6 ${activeStep !== "PAYMENT" && activeStep !== "REVIEW" && "hidden"}`}
        >
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">Payment</h2>
            <Button
              variant="ghost"
              size="sm"
              type="button"
              onClick={() => updateStep("SHIPPING")}
            >
              Edit Shipping
            </Button>
          </div>

          <FormField
            control={form.control}
            name="payment.payment_method"
            render={({ field }) => {
              const currentConfigs = paymentConfigs;
              const isCodEnabled = currentConfigs?.cod?.enabled ?? true;
              const isBkashEnabled = currentConfigs?.bkash?.enabled ?? true;
              const isNagadEnabled = currentConfigs?.nagad?.enabled ?? true;
              const isRocketEnabled = currentConfigs?.rocket?.enabled ?? true;
              const isBankEnabled = currentConfigs?.bank?.enabled ?? true;
              const isSslEnabled = currentConfigs?.sslcommerz?.enabled ?? true;

              const activeConfig =
                field.value === "COD"
                  ? currentConfigs?.cod
                  : field.value === "BKASH"
                  ? currentConfigs?.bkash
                  : field.value === "NAGAD"
                  ? currentConfigs?.nagad
                  : field.value === "ROCKET"
                  ? currentConfigs?.rocket
                  : field.value === "BANK_TRANSFER" || field.value === "BANK"
                  ? currentConfigs?.bank
                  : currentConfigs?.sslcommerz;

              return (
                <FormItem className="space-y-4">
                  <FormControl>
                    <RadioGroup
                      value={field.value || "COD"}
                      onValueChange={(val) => {
                        field.onChange(val);
                        setPayment({
                          ...form.getValues("payment"),
                          payment_method: val,
                        });
                      }}
                      className="flex flex-col space-y-2"
                    >
                      {isCodEnabled && (
                        <FormItem className="flex items-center space-x-3 space-y-0 rounded-lg border border-border p-4 transition-colors hover:border-primary/60 hover:bg-muted/40 data-[state=checked]:border-primary data-[state=checked]:bg-primary/5 cursor-pointer">
                          <FormControl>
                            <RadioGroupItem value="COD" />
                          </FormControl>
                          <div className="flex flex-1 items-center justify-between cursor-pointer">
                            <FormLabel className="cursor-pointer font-medium text-foreground text-sm">
                              Cash on Delivery (ক্যাশ অন ডেলিভারি)
                            </FormLabel>
                            <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                              Cash
                            </span>
                          </div>
                        </FormItem>
                      )}

                      {isBkashEnabled && (
                        <FormItem className="flex items-center space-x-3 space-y-0 rounded-lg border border-border p-4 transition-colors hover:border-[#E2136E]/60 hover:bg-pink-50/20 data-[state=checked]:border-[#E2136E] data-[state=checked]:bg-pink-50/30 cursor-pointer">
                          <FormControl>
                            <RadioGroupItem value="BKASH" />
                          </FormControl>
                          <div className="flex flex-1 items-center justify-between cursor-pointer">
                            <FormLabel className="cursor-pointer font-medium flex items-center gap-2 text-foreground text-sm">
                              <span className="h-2.5 w-2.5 rounded-full bg-[#E2136E]" />
                              bKash (বিকাশ)
                            </FormLabel>
                            <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-pink-100 text-[#E2136E] dark:bg-pink-950 dark:text-pink-300">
                              {currentConfigs?.bkash?.account_type || "Personal"}
                            </span>
                          </div>
                        </FormItem>
                      )}

                      {isNagadEnabled && (
                        <FormItem className="flex items-center space-x-3 space-y-0 rounded-lg border border-border p-4 transition-colors hover:border-[#F7941D]/60 hover:bg-orange-50/20 data-[state=checked]:border-[#F7941D] data-[state=checked]:bg-orange-50/30 cursor-pointer">
                          <FormControl>
                            <RadioGroupItem value="NAGAD" />
                          </FormControl>
                          <div className="flex flex-1 items-center justify-between cursor-pointer">
                            <FormLabel className="cursor-pointer font-medium flex items-center gap-2 text-foreground text-sm">
                              <span className="h-2.5 w-2.5 rounded-full bg-[#F7941D]" />
                              Nagad (নগদ)
                            </FormLabel>
                            <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-orange-100 text-[#F7941D] dark:bg-orange-950 dark:text-orange-300">
                              {currentConfigs?.nagad?.account_type || "Personal"}
                            </span>
                          </div>
                        </FormItem>
                      )}

                      {isRocketEnabled && (
                        <FormItem className="flex items-center space-x-3 space-y-0 rounded-lg border border-border p-4 transition-colors hover:border-[#8C3494]/60 hover:bg-purple-50/20 data-[state=checked]:border-[#8C3494] data-[state=checked]:bg-purple-50/30 cursor-pointer">
                          <FormControl>
                            <RadioGroupItem value="ROCKET" />
                          </FormControl>
                          <div className="flex flex-1 items-center justify-between cursor-pointer">
                            <FormLabel className="cursor-pointer font-medium flex items-center gap-2 text-foreground text-sm">
                              <span className="h-2.5 w-2.5 rounded-full bg-[#8C3494]" />
                              Rocket (রকেট)
                            </FormLabel>
                            <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-purple-100 text-[#8C3494] dark:bg-purple-950 dark:text-purple-300">
                              {currentConfigs?.rocket?.account_type || "Personal"}
                            </span>
                          </div>
                        </FormItem>
                      )}

                      {isBankEnabled && (
                        <FormItem className="flex items-center space-x-3 space-y-0 rounded-lg border border-border p-4 transition-colors hover:border-blue-600/60 hover:bg-blue-50/20 data-[state=checked]:border-blue-600 data-[state=checked]:bg-blue-50/30 cursor-pointer">
                          <FormControl>
                            <RadioGroupItem value="BANK_TRANSFER" />
                          </FormControl>
                          <div className="flex flex-1 items-center justify-between cursor-pointer">
                            <FormLabel className="cursor-pointer font-medium flex items-center gap-2 text-foreground text-sm">
                              <Landmark className="h-4 w-4 text-blue-600" />
                              Bank Transfer / Deposit (ব্যাংক ট্রান্সফার)
                            </FormLabel>
                            <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300">
                              BEFTN / NPSB
                            </span>
                          </div>
                        </FormItem>
                      )}

                      {isSslEnabled && (
                        <FormItem className="flex items-start space-x-3 space-y-0 rounded-lg border border-border p-4 transition-colors hover:border-emerald-600/60 hover:bg-emerald-50/10 data-[state=checked]:border-emerald-600 data-[state=checked]:bg-emerald-50/20 data-[state=checked]:ring-1 data-[state=checked]:ring-emerald-600 cursor-pointer">
                          <FormControl className="mt-1">
                            <RadioGroupItem value="SSLCOMMERZ" />
                          </FormControl>
                          <div className="flex flex-1 flex-col sm:flex-row sm:items-center justify-between gap-3 cursor-pointer">
                            <div>
                              <FormLabel className="cursor-pointer font-medium flex items-center gap-2 text-sm text-foreground">
                                <CreditCard className="h-4 w-4 text-emerald-600" />
                                <span>Cards / Mobile Banking (SSLCommerz Gateway)</span>
                              </FormLabel>
                              <p className="text-xs text-muted-foreground mt-0.5">
                                Visa, MasterCard, bKash, Nagad, Rocket, Net Banking
                              </p>
                            </div>
                            <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300 border border-emerald-300/50">
                                Instant Auto-Pay
                              </span>
                              <div className="flex items-center gap-1">
                                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300 border border-blue-200/50">VISA</span>
                                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300 border border-amber-200/50">Mastercard</span>
                                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-pink-50 text-[#E2136E] dark:bg-pink-950/50 dark:text-pink-300 border border-pink-200/50">bKash</span>
                                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-orange-50 text-[#F7941D] dark:bg-orange-950/50 dark:text-orange-300 border border-orange-200/50">Nagad</span>
                              </div>
                            </div>
                          </div>
                        </FormItem>
                      )}
                    </RadioGroup>
                  </FormControl>
                  <FormMessage />

                  {/* Dynamic Instructions and Payment Input Form */}
                  <div className="pt-2">
                    <ManualPaymentFields
                      form={form}
                      selectedMethod={field.value}
                      config={activeConfig}
                    />
                  </div>
                </FormItem>
              );
            }}
          />

          <div className="mt-8">
            <h3 className="mb-4 text-lg font-medium">Billing Address</h3>
            <FormField
              control={form.control}
              name="payment.billing_address_same_as_shipping"
              render={({ field }) => (
                <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4">
                  <FormControl>
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                  <div className="space-y-1 leading-none">
                    <FormLabel className="cursor-pointer">
                      Same as shipping address
                    </FormLabel>
                  </div>
                </FormItem>
              )}
            />
          </div>

          <FormField
            control={form.control}
            name="notes"
            render={({ field }) => (
              <FormItem className="mt-8">
                <FormLabel>Order Notes (Optional)</FormLabel>
                <FormControl>
                  <Textarea
                    placeholder="Any special instructions?"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className="mt-8 pt-6 border-t border-gray-100 flex items-center justify-center gap-2 text-xs text-gray-500">
            <Lock className="h-3 w-3" />
            <span>Payments are secure and encrypted.</span>
          </div>

          <Button
            type="submit"
            size="lg"
            className="mt-4 w-full h-14 bg-[#1A1A1A] text-sm font-bold uppercase tracking-widest text-white hover:bg-black"
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Processing Order...
              </>
            ) : (
              "Complete Order"
            )}
          </Button>
        </div>
    </>
  );
}
