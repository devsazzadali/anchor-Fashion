import { z } from "zod";
import { getServerSession, resolveUserRole, type NeonAuthSessionUser } from "@/lib/auth/server";
import { STAFF_ROLES } from "@/lib/constants/auth";

export type ActionState<T> = {
  success: boolean;
  data?: T;
  error?: string;
  errors?: Record<string, string[] | undefined>; // Form validation errors
};

type ProtectedActionContext = {
  user: NeonAuthSessionUser;
};

class DatabaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatabaseError";
  }
}

/**
 * Creates a public server action with Zod validation.
 */
export function createSafeAction<Input, Output>(
  schema: z.Schema<Input>,
  handler: (parsedInput: Input) => Promise<Output>
) {
  return async (input: Input): Promise<ActionState<Output>> => {
    try {
      const parsedInput = schema.parse(input);
      const data = await handler(parsedInput);
      return { success: true, data };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return {
          success: false,
          error: "Validation failed",
          errors: error.flatten().fieldErrors,
        };
      }
      if (error instanceof DatabaseError) {
        return { success: false, error: error.message };
      }
      return { success: false, error: "An unexpected error occurred." };
    }
  };
}

/**
 * Creates an authenticated server action.
 * Automatically verifies the user's session before executing the handler.
 */
export function createProtectedAction<Input, Output>(
  schema: z.Schema<Input>,
  handler: (parsedInput: Input, ctx: ProtectedActionContext) => Promise<Output>
) {
  return async (input: Input): Promise<ActionState<Output>> => {
    try {
      const { user } = await getServerSession();

      if (!user) {
        return { success: false, error: "Unauthorized. Please log in." };
      }

      const parsedInput = schema.parse(input);
      const data = await handler(parsedInput, { user });
      return { success: true, data };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return {
          success: false,
          error: "Validation failed",
          errors: error.flatten().fieldErrors,
        };
      }
      if (error instanceof DatabaseError) {
        return { success: false, error: error.message };
      }
      return { success: false, error: "An unexpected error occurred." };
    }
  };
}

/**
 * Creates an admin-only server action.
 * Verifies that the authenticated user possesses an administrative or operational role.
 */
export function createAdminAction<Input, Output>(
  schema: z.Schema<Input>,
  handler: (parsedInput: Input, ctx: ProtectedActionContext) => Promise<Output>
) {
  return async (input: Input): Promise<ActionState<Output>> => {
    try {
      const { user } = await getServerSession();

      if (!user) {
        return { success: false, error: "Unauthorized. Please log in." };
      }

      const role = await resolveUserRole(user);
      const isAllowed = STAFF_ROLES.includes(role) || ["OPERATIONS"].includes(role);

      if (!isAllowed) {
        return { success: false, error: "Forbidden. Insufficient permissions." };
      }

      const parsedInput = schema.parse(input);
      const data = await handler(parsedInput, { user });
      return { success: true, data };
    } catch (error) {
      if (error instanceof z.ZodError) {
        const fieldErrors = error.flatten().fieldErrors;
        const firstError = Object.values(fieldErrors)[0]?.[0];
        return {
          success: false,
          error: firstError || "Validation failed. Please check the form fields.",
          errors: fieldErrors,
        };
      }
      if (error instanceof DatabaseError) {
        return { success: false, error: error.message };
      }
      const isProd = process.env.NODE_ENV === "production";
      // The operational flag is an optional ad-hoc property some thrown
      // errors carry; it is read, never set, here.
      const isOperational =
        error instanceof Error &&
        (error as Error & { isOperational?: boolean }).isOperational === true;
      const message =
        isProd && !isOperational
          ? "An unexpected system error occurred. Please try again or contact support."
          : error instanceof Error
            ? error.message || "An unexpected error occurred."
            : "An unexpected error occurred.";
      return { success: false, error: message };
    }
  };
}
