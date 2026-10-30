import { z } from "zod";

/**
 * Bangladeshi mobile number: exactly 11 digits starting with 01.
 *
 * Shared by the registration form (client-side) and the server action
 * that persists the number on the new account's profile, so both sides
 * enforce the identical rule. The minimum-length message intentionally
 * matches the checkout address schema's language
 * (schemas/checkout.schema.ts: "Phone number must be at least 11 digits").
 */
export const bdMobileSchema = z
  .string()
  .trim()
  .min(11, "Phone number must be at least 11 digits")
  .regex(
    /^01\d{9}$/,
    "Enter a valid mobile number (11 digits starting with 01)"
  );
