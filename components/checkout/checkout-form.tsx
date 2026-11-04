"use client";

import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useCheckoutStore } from "@/stores/use-checkout-store";
import { useCartStore } from "@/stores/use-cart-store";
import {
  checkoutFormSchema,
  CheckoutFormValues,
} from "@/schemas/checkout.schema";
import {
  processCheckoutAction,
  sendCodOtpAction,
} from "@/lib/actions/checkout.actions";
import { CodOtpDialog } from "@/components/checkout/cod-otp-dialog";
import { CheckoutInformationStep } from "@/components/checkout/checkout-form.information-step";
import { CheckoutShippingStep } from "@/components/checkout/checkout-form.shipping-step";
import { CheckoutPaymentStep } from "@/components/checkout/checkout-form.payment-step";

import { Form } from "@/components/ui/form";
import { toast } from "sonner";
import { AllPaymentConfigs } from "@/lib/actions/payment.actions";
import { getPublicZonesAction } from "@/lib/actions/shipping.actions";
import {
  dhakaZone,
  defaultZone,
  type PublicZone,
} from "@/lib/services/shipping/zone-shared";

export function CheckoutForm({
  checkoutSessionId,
  paymentConfigs,
  cartId,
}: {
  checkoutSessionId: string;
  paymentConfigs?: AllPaymentConfigs;
  cartId?: string;
}) {
  const router = useRouter();
  const { cart } = useCartStore();
  const {
    formData,
    currentStep,
    updateStep,
    setInformation,
    setShipping,
    setPayment,
  } = useCheckoutStore();
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Delivery-zone charges (admin-configured in Settings → Store). The two
  // shipping methods map to the zone covering Dhaka and the default zone;
  // the legacy flat rates below only render until zone data loads.
  const [zones, setZones] = useState<PublicZone[]>([]);
  useEffect(() => {
    let cancelled = false;
    getPublicZonesAction()
      .then((res) => {
        if (!cancelled && res.success) setZones(res.data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  const insideZone = dhakaZone(zones);
  const outsideZone = defaultZone(zones);
  const insideRate = insideZone?.rate ?? 100;
  const outsideRate = outsideZone?.rate ?? 150;

  // COD Fraud Shield OTP Verification states
  const [showOtpDialog, setShowOtpDialog] = useState(false);
  const [otpTarget, setOtpTarget] = useState("");
  const [otpTargetType, setOtpTargetType] = useState<"email" | "phone">("email");
  const [otpError, setOtpError] = useState<string | null>(null);
  const [isVerifyingOtp, setIsVerifyingOtp] = useState(false);
  const [isResendingOtp, setIsResendingOtp] = useState(false);
  const [otpCooldown, setOtpCooldown] = useState(60);
  const [otpExpirySeconds, setOtpExpirySeconds] = useState(600);



  const form = useForm<CheckoutFormValues>({
    resolver: zodResolver(checkoutFormSchema),
    // A3-C4: validate on blur (the auth forms' inline standard) — with
    // the default onSubmit mode a shopper could type garbage into the
    // email/phone fields, blur, and see no error anywhere. Client-side
    // only: submit handling and the order logic are unchanged.
    mode: "onBlur",
    defaultValues: {
      information: {
        email: formData.information?.email || "",
        shipping_address: {
          first_name: formData.information?.shipping_address?.first_name || "",
          last_name: formData.information?.shipping_address?.last_name || "",
          phone: formData.information?.shipping_address?.phone || "",
          address_line_1:
            formData.information?.shipping_address?.address_line_1 || "",
          address_line_2:
            formData.information?.shipping_address?.address_line_2 || "",
          city: formData.information?.shipping_address?.city || "",
          postal_code:
            formData.information?.shipping_address?.postal_code || "",
          country:
            formData.information?.shipping_address?.country || "Bangladesh",
        },
        save_information: false,
        create_account: false,
        password: "",
      },
      shipping: {
        shipping_method: formData.shipping?.shipping_method || "home_delivery",
      },
      payment: {
        payment_method: formData.payment?.payment_method || "COD",
        billing_address_same_as_shipping:
          formData.payment?.billing_address_same_as_shipping ?? true,
        manual_payment: {
          sender_number: "",
          transaction_id: "",
          bank_name: "",
          branch_name: "",
          account_holder_name: "",
          notes: "",
        },
      },
      notes: formData.notes || "",
    },
  });


  const activeStep = currentStep === "COMPLETED" ? "REVIEW" : currentStep;

  // Sync form with external store when loaded/hydrated
  useEffect(() => {
    if (formData.information?.email && !form.getValues("information.email")) {
      form.reset({
        information: {
          email: formData.information?.email || "",
          shipping_address: {
            first_name: formData.information?.shipping_address?.first_name || "",
            last_name: formData.information?.shipping_address?.last_name || "",
            phone: formData.information?.shipping_address?.phone || "",
            address_line_1: formData.information?.shipping_address?.address_line_1 || "",
            address_line_2: formData.information?.shipping_address?.address_line_2 || "",
            city: formData.information?.shipping_address?.city || "",
            postal_code: formData.information?.shipping_address?.postal_code || "",
            country: formData.information?.shipping_address?.country || "Bangladesh",
          },
          save_information: false,
          create_account: false,
          password: "",
        },
        shipping: {
          shipping_method: formData.shipping?.shipping_method || "home_delivery",
        },
        payment: {
          payment_method: formData.payment?.payment_method || "COD",
          billing_address_same_as_shipping:
            formData.payment?.billing_address_same_as_shipping ?? true,
          manual_payment: {
            sender_number: "",
            transaction_id: "",
            bank_name: "",
            branch_name: "",
            account_holder_name: "",
            notes: "",
          },
        },
        notes: formData.notes || "",
      });
    }
  }, [formData, form]);

  const handleNextStep = async (
    step: "INFORMATION" | "SHIPPING" | "PAYMENT" | "REVIEW"
  ) => {
    try {
      if (step === "SHIPPING") {
        const isInfoValid = await form.trigger("information");
        if (!isInfoValid) {
          toast.error("Please fill in all required contact and address details.");
          return;
        }
        const city = form.getValues("information.shipping_address.city");
        const currentShipping = form.getValues("shipping.shipping_method");
        const defaultMethod =
          city && city.toLowerCase().includes("dhaka")
            ? "home_delivery"
            : "home_delivery_outside";
        const methodToSet = currentShipping || defaultMethod;
        form.setValue("shipping.shipping_method", methodToSet, {
          shouldValidate: true,
        });

        setInformation(form.getValues("information"));
        setShipping({ shipping_method: methodToSet });
        updateStep("SHIPPING");
      } else if (step === "PAYMENT") {
        // Ensure shipping method is set
        const currentMethod = form.getValues("shipping.shipping_method");
        if (!currentMethod) {
          form.setValue("shipping.shipping_method", "home_delivery", {
            shouldValidate: true,
          });
        }

        const isShippingValid = await form.trigger("shipping.shipping_method");
        if (!isShippingValid) {
          toast.error("Please select a shipping method.");
          return;
        }

        const isInfoValid = await form.trigger("information");
        if (!isInfoValid) {
          toast.error("Please complete your shipping address details first.");
          updateStep("INFORMATION");
          return;
        }

        setInformation(form.getValues("information"));
        setShipping(form.getValues("shipping"));
        updateStep("PAYMENT");
      } else if (step === "REVIEW") {
        const isPaymentValid = await form.trigger("payment");
        if (!isPaymentValid) {
          toast.error("Please complete your payment details.");
          return;
        }
        setPayment(form.getValues("payment"));
        updateStep("REVIEW");
      }
    } catch (err) {
      updateStep(step);
    }
  };

  const activeCartId = cartId || cart?.id;

  const onInvalid = (errors: any) => {

    if (errors.information) {
      const firstKey = Object.keys(errors.information)[0];
      const infoErr = errors.information[firstKey];
      let msg = "Please complete all required contact & shipping address details.";
      if (typeof infoErr?.message === "string") {
        msg = infoErr.message;
      } else if (errors.information.shipping_address) {
        const subKey = Object.keys(errors.information.shipping_address)[0];
        if (errors.information.shipping_address[subKey]?.message) {
          msg = errors.information.shipping_address[subKey].message;
        }
      }
      toast.error(msg);
      updateStep("INFORMATION");
      return;
    }

    if (errors.shipping) {
      toast.error(errors.shipping.shipping_method?.message || "Please select a shipping method.");
      updateStep("SHIPPING");
      return;
    }

    if (errors.payment) {
      const payErr =
        errors.payment.payment_method?.message ||
        errors.payment.manual_payment?.sender_number?.message ||
        errors.payment.manual_payment?.transaction_id?.message ||
        errors.payment.billing_address?.message ||
        "Please complete all required payment details.";
      toast.error(payErr);
      return;
    }

    toast.error("Please fill in all required fields before completing your order.");
  };

  const onSubmit = async (data: CheckoutFormValues) => {
    const finalCartId = activeCartId;
    if (!finalCartId) {
      toast.error("Cart not found or session expired. Please refresh the page.");
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await processCheckoutAction(finalCartId, checkoutSessionId, data);

      // Check if server-side COD Fraud Shield requires OTP verification
      if (res.verificationRequired) {
        setOtpTarget(res.maskedTarget || data.information.email);
        setOtpTargetType(res.targetType || "email");
        setOtpCooldown(res.remainingCooldownSeconds || 60);
        // REG-45: arm the dialog countdown from the server's code lifetime.
        if (res.expirySeconds) setOtpExpirySeconds(res.expirySeconds);
        setOtpError(null);
        setShowOtpDialog(true);
        setIsSubmitting(false);
        return;
      }

      if (res.success && res.orderId) {
        toast.success("Order placed successfully!");
        if (data.payment.payment_method === "SSLCOMMERZ") {
          // Redirect to payment initialization endpoint for gateway integration via full window navigation
          window.location.href = `/api/payment/init?order_id=${res.orderId}&method=SSLCOMMERZ`;
          return;
        } else {
          router.push(`/checkout/success?order_id=${res.orderId}`);
        }
      } else {
        toast.error(res.error || "Failed to process checkout");
      }
    } catch (error) {
      toast.error("An unexpected error occurred");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleVerifyOtp = async (otp: string) => {
    const finalCartId = activeCartId;
    if (!finalCartId) return;
    setIsVerifyingOtp(true);
    setOtpError(null);
    try {
      const currentData = form.getValues();
      const res = await processCheckoutAction(
        finalCartId,
        checkoutSessionId,
        currentData,
        otp
      );

      if (res.success && res.orderId) {
        setShowOtpDialog(false);
        toast.success("Order verified and placed successfully!");
        if (currentData.payment.payment_method === "SSLCOMMERZ") {
          window.location.href = `/api/payment/init?order_id=${res.orderId}&method=SSLCOMMERZ`;
          return;
        }
        router.push(`/checkout/success?order_id=${res.orderId}`);
      } else {
        setOtpError(res.error || "Failed to verify code. Please try again.");
      }
    } catch {
      setOtpError("An error occurred during verification. Please try again.");
    } finally {
      setIsVerifyingOtp(false);
    }
  };

  const handleResendOtp = async (): Promise<{ expirySeconds?: number } | undefined> => {
    setIsResendingOtp(true);
    try {
      const currentData = form.getValues();
      const res = await sendCodOtpAction(checkoutSessionId, currentData);
      if (res.success) {
        toast.success("A new verification code has been dispatched.");
        setOtpError(null);
        // REG-45: hand the fresh code's lifetime back so the dialog can
        // genuinely re-arm its countdown and re-enable Verify.
        if (res.expirySeconds) setOtpExpirySeconds(res.expirySeconds);
        return { expirySeconds: res.expirySeconds };
      } else {
        setOtpError(res.error || "Failed to resend verification code.");
      }
    } catch {
      setOtpError("Failed to resend verification code.");
    } finally {
      setIsResendingOtp(false);
    }
    return undefined;
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit, onInvalid)} className="space-y-8">
        <CheckoutInformationStep
          form={form}
          activeStep={activeStep}
          handleNextStep={handleNextStep}
        />

        <CheckoutShippingStep
          form={form}
          activeStep={activeStep}
          updateStep={updateStep}
          setShipping={setShipping}
          insideZone={insideZone}
          outsideZone={outsideZone}
          insideRate={insideRate}
          outsideRate={outsideRate}
          handleNextStep={handleNextStep}
        />

        <CheckoutPaymentStep
          form={form}
          activeStep={activeStep}
          paymentConfigs={paymentConfigs}
          setPayment={setPayment}
          updateStep={updateStep}
          isSubmitting={isSubmitting}
        />
      </form>

      {/* COD Fraud Shield Verification Dialog */}
      <CodOtpDialog
        open={showOtpDialog}
        onOpenChange={setShowOtpDialog}
        maskedTarget={otpTarget}
        targetType={otpTargetType}
        onVerify={handleVerifyOtp}
        onResend={handleResendOtp}
        isVerifying={isVerifyingOtp}
        isResending={isResendingOtp}
        initialCooldown={otpCooldown}
        initialExpirySeconds={otpExpirySeconds}
        errorMessage={otpError}
      />
    </Form>
  );
}
