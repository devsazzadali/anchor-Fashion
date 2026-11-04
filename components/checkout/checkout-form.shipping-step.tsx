"use client";

import type { UseFormReturn } from "react-hook-form";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type {
  CheckoutFormValues,
  CheckoutShippingFormValues,
} from "@/schemas/checkout.schema";
import type { CheckoutStep } from "@/types/checkout.types";
import type { PublicZone } from "@/lib/services/shipping/zone-shared";

export interface CheckoutShippingStepProps {
  form: UseFormReturn<CheckoutFormValues>;
  activeStep: string;
  updateStep: (step: CheckoutStep) => Promise<void>;
  setShipping: (data: CheckoutShippingFormValues) => void;
  insideZone: PublicZone | null;
  outsideZone: PublicZone | null;
  insideRate: number;
  outsideRate: number;
  handleNextStep: (
    step: "INFORMATION" | "SHIPPING" | "PAYMENT" | "REVIEW"
  ) => Promise<void>;
}

export function CheckoutShippingStep({
  form,
  activeStep,
  updateStep,
  setShipping,
  insideZone,
  outsideZone,
  insideRate,
  outsideRate,
  handleNextStep,
}: CheckoutShippingStepProps) {
  return (
    <>
        {/* Step 2: Shipping */}
        <div className={`space-y-6 ${activeStep !== "SHIPPING" && "hidden"}`}>
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">Shipping Method</h2>
            <Button
              variant="ghost"
              size="sm"
              type="button"
              onClick={() => updateStep("INFORMATION")}
            >
              Edit Information
            </Button>
          </div>

          <FormField
            control={form.control}
            name="shipping.shipping_method"
            render={({ field }) => (
              <FormItem className="space-y-3">
                <FormControl>
                  <RadioGroup
                    value={field.value || "home_delivery"}
                    onValueChange={(val) => {
                      field.onChange(val);
                      setShipping({ shipping_method: val });
                    }}
                    className="flex flex-col space-y-1"
                  >
                    <FormItem className="flex items-center space-x-3 space-y-0 rounded-md border border-border p-4 transition-colors hover:border-primary/60 hover:bg-muted/40 data-[state=checked]:border-primary data-[state=checked]:bg-primary/5 cursor-pointer">
                      <FormControl>
                        <RadioGroupItem value="home_delivery" />
                      </FormControl>
                      <div className="flex flex-1 justify-between items-center cursor-pointer">
                        <div className="flex flex-col">
                          <FormLabel className="cursor-pointer font-medium text-foreground text-sm">
                            Home Delivery ({insideZone?.name || "Inside Dhaka"})
                          </FormLabel>
                          <span className="text-xs text-muted-foreground mt-0.5">Est. 1-2 business days</span>
                        </div>
                        <span className="font-semibold text-foreground">
                          ৳ {insideRate}
                        </span>
                      </div>
                    </FormItem>
                    <FormItem className="flex items-center space-x-3 space-y-0 rounded-md border border-border p-4 transition-colors hover:border-primary/60 hover:bg-muted/40 data-[state=checked]:border-primary data-[state=checked]:bg-primary/5 cursor-pointer">
                      <FormControl>
                        <RadioGroupItem value="home_delivery_outside" />
                      </FormControl>
                      <div className="flex flex-1 justify-between items-center cursor-pointer">
                        <div className="flex flex-col">
                          <FormLabel className="cursor-pointer font-medium text-foreground text-sm">
                            Home Delivery ({outsideZone?.name || "Outside Dhaka"})
                          </FormLabel>
                          <span className="text-xs text-muted-foreground mt-0.5">Est. 3-5 business days</span>
                        </div>
                        <span className="font-semibold text-foreground">
                          ৳ {outsideRate}
                        </span>
                      </div>
                    </FormItem>
                  </RadioGroup>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <Button
            type="button"
            size="lg"
            className="mt-6 w-full h-12 bg-[#1A1A1A] text-xs font-bold uppercase tracking-widest text-white hover:bg-black dark:bg-primary dark:text-primary-foreground dark:hover:bg-primary/90"
            onClick={() => handleNextStep("PAYMENT")}
          >
            Continue to Payment <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
    </>
  );
}
