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
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import type { CheckoutFormValues } from "@/schemas/checkout.schema";

export interface CheckoutInformationStepProps {
  form: UseFormReturn<CheckoutFormValues>;
  activeStep: string;
  handleNextStep: (
    step: "INFORMATION" | "SHIPPING" | "PAYMENT" | "REVIEW"
  ) => Promise<void>;
}

export function CheckoutInformationStep({
  form,
  activeStep,
  handleNextStep,
}: CheckoutInformationStepProps) {
  return (
    <>
        {/* Step 1: Information */}
        <div
          className={`space-y-6 ${activeStep !== "INFORMATION" && "hidden"}`}
        >
          <div>
            <h2 className="mb-4 text-xl font-semibold">Contact Information</h2>
            <FormField
              control={form.control}
              name="information.email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email Address</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="you@example.com"
                      {...field}
                      type="email"
                      required
                      autoComplete="email"
                      inputMode="email"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <div>
            <h2 className="mb-4 mt-8 text-xl font-semibold">
              Shipping Address
            </h2>
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="information.shipping_address.first_name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>First Name</FormLabel>
                    <FormControl>
                      <Input placeholder="John" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="information.shipping_address.last_name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Last Name</FormLabel>
                    <FormControl>
                      <Input placeholder="Doe" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="information.shipping_address.phone"
              render={({ field }) => (
                <FormItem className="mt-4">
                  <FormLabel>Phone Number</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="01XXXXXXXXX"
                      {...field}
                      type="tel"
                      required
                      autoComplete="tel"
                      inputMode="tel"
                      pattern="(\+?880|0)1[3-9][0-9]{8}"
                      title="Enter a valid mobile number (11 digits starting with 01)"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="information.shipping_address.address_line_1"
              render={({ field }) => (
                <FormItem className="mt-4">
                  <FormLabel>Address</FormLabel>
                  <FormControl>
                    <Input placeholder="House, Road, Area" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="mt-4 grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="information.shipping_address.city"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>City</FormLabel>
                    <FormControl>
                      <Input placeholder="Dhaka" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="information.shipping_address.postal_code"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Postal Code</FormLabel>
                    <FormControl>
                      <Input placeholder="1212" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </div>

          <div className="mt-4 p-4 border border-zinc-200 dark:border-zinc-800 rounded-lg bg-zinc-50 dark:bg-zinc-900/60">
            <FormField
              control={form.control}
              name="information.create_account"
              render={({ field }) => (
                <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                  <FormControl>
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                  <div className="space-y-1 leading-none">
                    <FormLabel className="cursor-pointer font-medium text-foreground">
                      Save details & create an account
                    </FormLabel>
                    <p className="text-xs text-muted-foreground mt-1">
                      Check this box to easily track your order and checkout faster next time.
                    </p>
                  </div>
                </FormItem>
              )}
            />

            {form.watch("information.create_account") && (
              <FormField
                control={form.control}
                name="information.password"
                render={({ field }) => (
                  <FormItem className="mt-4 animate-in slide-in-from-top-2">
                    <FormLabel>Set a Password</FormLabel>
                    <FormControl>
                      <Input type="password" placeholder="••••••••" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}
          </div>

          <Button
            type="button"
            size="lg"
            className="mt-6 w-full h-12 bg-[#1A1A1A] text-xs font-bold uppercase tracking-widest text-white hover:bg-black"
            onClick={() => handleNextStep("SHIPPING")}
          >
            Continue to Shipping <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
    </>
  );
}
