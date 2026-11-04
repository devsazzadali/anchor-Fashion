import { db } from "@/lib/db/client";
import {
  automationRules,
  WorkflowActionPayload,
  WorkflowTrigger,
} from "./rules";

export interface WorkflowEvent {
  triggerEvent: WorkflowTrigger;
  payload: WorkflowActionPayload;
}

export interface WorkflowExecutionLog {
  workflow_id: string;
  trigger_event: string;
  status: "PENDING" | "SUCCESS" | "FAILED";
  error_message?: string;
  execution_details?: unknown;
}

/**
 * Enterprise Workflow Automation Engine
 * Evaluates triggers and executes corresponding workflows.
 */
export async function executeWorkflows(event: WorkflowEvent) {
  const logs: WorkflowExecutionLog[] = [];

  try {
    // 1. Fetch active workflows matching the trigger
    const { data: workflows, error } = await db
      .from("ai_workflows")
      .select("*")
      .eq("trigger_event", event.triggerEvent)
      .eq("is_active", true);

    if (error) {
      throw error;
    }

    if (!workflows || workflows.length === 0) {
      return;
    }

    // 2. Map predefined rules for the trigger
    const ruleFns = automationRules[event.triggerEvent] || [];

    // 3. Execute all mapped actions
    for (const workflow of workflows) {
      for (const ruleFn of ruleFns) {
        try {
          const actionResult = await ruleFn(event.payload, workflow.config);

          logs.push({
            workflow_id: workflow.id,
            trigger_event: event.triggerEvent,
            status: "SUCCESS",
            execution_details: actionResult,
          });
        } catch (actionError) {
          logs.push({
            workflow_id: workflow.id,
            trigger_event: event.triggerEvent,
            status: "FAILED",
            error_message: (actionError as Error).message,
          });
        }
      }
    }
  } catch (err) {
    throw err;
  }
}
