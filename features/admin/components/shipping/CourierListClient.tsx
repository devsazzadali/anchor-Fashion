"use client";

import { useState, useEffect } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Truck,
  Activity,
  Settings,
  RefreshCcw,
  CheckCircle2,
  AlertCircle,
  FileText,
} from "lucide-react";
import { CourierProviderRecord } from "@/types/shipping.types";
import {
  updateCourierProviderAction,
  createCourierProviderAction,
  getCourierMetricsAction,
  testCourierConnectionAction,
  CourierMetrics,
} from "@/actions/logistics.actions";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus } from "lucide-react";

const COURIER_CODE_OPTIONS = [
  { code: "steadfast", label: "Steadfast" },
  { code: "pathao", label: "Pathao" },
  { code: "redx", label: "RedX" },
  { code: "paperfly", label: "Paperfly" },
  { code: "sundarban", label: "Sundarban Courier" },
  { code: "ecourier", label: "eCourier" },
  { code: "dhl", label: "DHL" },
  { code: "fedex", label: "FedEx" },
  { code: "ups", label: "UPS" },
  { code: "sandbox", label: "Sandbox (test)" },
];
import { toast } from "sonner";
import { ConfirmDialog } from "@/features/admin/components/shared/ConfirmDialog";
import { CourierConfigModal } from "./CourierConfigModal";
import { CourierLogsModal } from "./CourierLogsModal";

interface Props {
  initialCouriers: CourierProviderRecord[];
}

export function CourierListClient({ initialCouriers }: Props) {
  const [couriers, setCouriers] = useState(initialCouriers);
  const [metrics, setMetrics] = useState<Record<string, CourierMetrics>>({});
  const [selectedCourier, setSelectedCourier] = useState<CourierProviderRecord | null>(null);
  const [logsCourier, setLogsCourier] = useState<CourierProviderRecord | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newCourier, setNewCourier] = useState({
    code: "steadfast",
    name: "",
    apiKey: "",
    secretKey: "",
    isSandbox: false,
    isActive: true,
  });

  const handleCreateCourier = async () => {
    setCreating(true);
    try {
      const res = await createCourierProviderAction({
        code: newCourier.code,
        name: newCourier.name.trim() || newCourier.code,
        apiKey: newCourier.apiKey,
        secretKey: newCourier.secretKey,
        isSandbox: newCourier.isSandbox,
        isActive: newCourier.isActive,
      });
      if (!res.success || !res.data) {
        throw new Error(res.success ? "Create failed" : res.error);
      }
      toast.success(`${res.data.display_name} added. Configure or test it any time.`);
      setCouriers((prev) => [...prev, res.data!]);
      setAddOpen(false);
      setNewCourier({
        code: "steadfast",
        name: "",
        apiKey: "",
        secretKey: "",
        isSandbox: false,
        isActive: true,
      });
    } catch (err: any) {
      toast.error(err.message || "Failed to add courier");
    } finally {
      setCreating(false);
    }
  };
  const [healthMap, setHealthMap] = useState<Record<string, { status: string; latency?: number }>>({});

  const loadMetricsAndHealth = async (currentCouriers?: CourierProviderRecord[]) => {
    setSyncing(true);
    try {
      const res = await getCourierMetricsAction();
      if (res.success && res.data) {
        setMetrics(res.data);
      }

      const couriersToEvaluate = currentCouriers || couriers;

      // Check health for active couriers
      const newHealthMap: Record<string, { status: string; latency?: number }> = {};
      for (const courier of couriersToEvaluate) {
        if (!courier.is_active) {
          newHealthMap[courier.id] = { status: "offline" };
          continue;
        }

        const creds = courier.credentials || {};
        const hasCreds = Object.values(creds).some(
          (v) => typeof v === "string" && v.trim() !== ""
        );
        const isSandbox = courier.code === "sandbox";

        if (!hasCreds && !isSandbox) {
          newHealthMap[courier.id] = { status: "not_configured" };
          continue;
        }

        // Test connection asynchronously
        try {
          const healthRes = await testCourierConnectionAction(courier.id);
          if (healthRes.success && healthRes.data) {
            newHealthMap[courier.id] = {
              status: healthRes.data.status,
              latency: healthRes.data.responseTime,
            };
          } else {
            newHealthMap[courier.id] = { status: "unhealthy" };
          }
        } catch {
          newHealthMap[courier.id] = { status: "unhealthy" };
        }
      }
      setHealthMap(newHealthMap);
    } catch (err: any) {
      toast.error(err.message || "Failed to sync status");
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    loadMetricsAndHealth();
  }, [couriers.length]);

  const [pendingDeactivation, setPendingDeactivation] = useState<string | null>(null);

  const handleToggle = async (id: string, checked: boolean) => {
    if (!checked && pendingDeactivation !== id) {
      // Gate deactivation behind the shared in-app dialog (replaces window.confirm)
      setPendingDeactivation(id);
      return;
    }
    if (pendingDeactivation === id) setPendingDeactivation(null);

    const nextCouriers = couriers.map((c) =>
      c.id === id ? { ...c, is_active: checked } : c
    );
    setCouriers(nextCouriers);

    try {
      const res = await updateCourierProviderAction(id, { is_active: checked });
      if (!res.success) throw new Error(res.error);
      toast.success(checked ? "Courier activated" : "Courier deactivated");
      loadMetricsAndHealth(nextCouriers);
    } catch (err: any) {
      toast.error(err.message);
      // Revert
      setCouriers(couriers);
    }
  };

  const renderHealthIndicator = (courier: CourierProviderRecord) => {
    if (!courier.is_active) {
      return (
        <span className="text-muted-foreground flex items-center text-xs">
          Integration Offline
        </span>
      );
    }

    const health = healthMap[courier.id];
    if (!health) {
      return (
        <span className="text-muted-foreground flex items-center text-xs">
          <Activity className="mr-1 h-3 w-3 animate-pulse" /> Checking Health...
        </span>
      );
    }

    if (health.status === "healthy") {
      return (
        <span className="flex items-center text-emerald-600 font-medium text-xs">
          <CheckCircle2 className="mr-1 h-3 w-3" /> Connected ({health.latency ?? 0}ms)
        </span>
      );
    }

    if (health.status === "degraded") {
      return (
        <span className="flex items-center text-amber-600 font-medium text-xs">
          <AlertCircle className="mr-1 h-3 w-3" /> Degraded ({health.latency ?? 0}ms)
        </span>
      );
    }

    if (health.status === "not_configured") {
      return (
        <span className="flex items-center text-muted-foreground font-medium text-xs">
          Not Configured
        </span>
      );
    }

    return (
      <span className="flex items-center text-rose-600 font-medium text-xs">
        <AlertCircle className="mr-1 h-3 w-3" /> Connection Error
      </span>
    );
  };

  return (
    <>
      <div className="flex flex-col gap-6">
        <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">
              Courier Integrations
            </h1>
            <p className="text-muted-foreground">
              Manage logistics partners, live API health, and COD settlements.
            </p>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => setAddOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Add Courier
            </Button>
            <Button
              variant="outline"
              onClick={() => loadMetricsAndHealth()}
              disabled={syncing}
            >
              <RefreshCcw className={`mr-2 h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
              Sync Status
            </Button>
          </div>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          {couriers.length === 0 && (
            <div className="col-span-2 text-center text-muted-foreground py-12">
              No couriers configured in database.
            </div>
          )}
          {couriers.map((courier) => {
            const courierMetric = metrics[courier.id];
            const activeShipmentsCount = courierMetric ? courierMetric.activeShipments : 0;
            const pendingCODAmount = courierMetric ? courierMetric.pendingCOD : 0;

            return (
              <Card
                key={courier.id}
                className={!courier.is_active ? "opacity-75 bg-muted/20" : ""}
              >
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <div className="flex items-center space-x-4">
                    {courier.logo_url ? (
                      <img
                        src={courier.logo_url}
                        alt={courier.name}
                        className="h-12 w-12 object-contain rounded-md"
                      />
                    ) : (
                      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-xl font-bold text-primary">
                        {courier.display_name.charAt(0)}
                      </div>
                    )}
                    <div>
                      <CardTitle className="text-xl flex items-center">
                        {courier.display_name}
                        {courier.is_sandbox && (
                          <Badge variant="secondary" className="ml-2 text-[10px] font-mono">
                            SANDBOX
                          </Badge>
                        )}
                      </CardTitle>
                      <CardDescription className="mt-1">
                        {renderHealthIndicator(courier)}
                      </CardDescription>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Label htmlFor={`status-${courier.id}`} className="sr-only">
                      Toggle {courier.name}
                    </Label>
                    <Switch
                      id={`status-${courier.id}`}
                      checked={courier.is_active}
                      onCheckedChange={(checked) =>
                        handleToggle(courier.id, checked)
                      }
                    />
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="my-4 grid grid-cols-2 gap-4">
                    <div className="flex flex-col rounded-md bg-muted/50 p-3">
                      <span className="mb-1 text-xs text-muted-foreground">
                        Active Shipments
                      </span>
                      <span className="flex items-center text-xl font-semibold">
                        <Truck className="mr-2 h-4 w-4 text-blue-500" />
                        {activeShipmentsCount}
                      </span>
                    </div>
                    <div className="flex flex-col rounded-md bg-muted/50 p-3">
                      <span className="mb-1 text-xs text-muted-foreground">
                        Pending COD
                      </span>
                      <span className="flex items-center text-xl font-semibold">
                        <span className="mr-1 font-bold text-amber-500">৳</span>
                        {pendingCODAmount.toLocaleString()}
                      </span>
                    </div>
                  </div>

                  <div>
                    <span className="text-sm font-medium">Supported Features:</span>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {courier.is_cod_supported && (
                        <Badge variant="secondary" className="font-normal">
                          COD
                        </Badge>
                      )}
                      <Badge variant="secondary" className="font-normal">
                        API Sync
                      </Badge>
                      <Badge variant="secondary" className="font-normal">
                        Live Tracking
                      </Badge>
                    </div>
                  </div>
                </CardContent>
                <CardFooter className="flex justify-between border-t pt-4">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setLogsCourier(courier)}
                  >
                    <FileText className="mr-2 h-4 w-4" /> View API Logs
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setSelectedCourier(courier)}
                  >
                    <Settings className="mr-2 h-4 w-4" /> Configure Settings
                  </Button>
                </CardFooter>
              </Card>
            );
          })}
        </div>
      </div>

      <CourierConfigModal
        courier={selectedCourier}
        onClose={() => setSelectedCourier(null)}
        onSaved={(updated) => {
          const next = couriers.map((c) =>
            c.id === updated.id ? { ...c, ...updated } : c
          );
          setCouriers(next);
          setSelectedCourier(null);
          loadMetricsAndHealth(next);
        }}
      />

      <CourierLogsModal
        courier={logsCourier}
        onClose={() => setLogsCourier(null)}
      />

      {/* Add Courier (Phase 9): providers can now be created from the
          dashboard — previously only pre-seeded rows could be edited. */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Courier Provider</DialogTitle>
            <DialogDescription>
              Add a delivery partner now — credentials can be pasted here or
              added later under Configure Settings. Keys are stored encrypted.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="new-courier-code">Provider</Label>
              <Select
                value={newCourier.code}
                onValueChange={(v) =>
                  setNewCourier((s) => ({
                    ...s,
                    code: v,
                    name:
                      s.name ||
                      COURIER_CODE_OPTIONS.find((o) => o.code === v)?.label ||
                      "",
                  }))
                }
              >
                <SelectTrigger id="new-courier-code">
                  <SelectValue placeholder="Select provider" />
                </SelectTrigger>
                <SelectContent>
                  {COURIER_CODE_OPTIONS.map((o) => (
                    <SelectItem key={o.code} value={o.code}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-courier-name">Display name</Label>
              <Input
                id="new-courier-name"
                value={newCourier.name}
                onChange={(e) =>
                  setNewCourier((s) => ({ ...s, name: e.target.value }))
                }
                placeholder="e.g. Steadfast"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-courier-key">API key</Label>
              <Input
                id="new-courier-key"
                value={newCourier.apiKey}
                onChange={(e) =>
                  setNewCourier((s) => ({ ...s, apiKey: e.target.value }))
                }
                placeholder="Paste the merchant API key (optional for now)"
                autoComplete="off"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-courier-secret">Secret key</Label>
              <Input
                id="new-courier-secret"
                type="password"
                value={newCourier.secretKey}
                onChange={(e) =>
                  setNewCourier((s) => ({ ...s, secretKey: e.target.value }))
                }
                placeholder="Paste the merchant secret key (optional for now)"
                autoComplete="off"
              />
            </div>
            <div className="flex items-center justify-between rounded-lg border px-3 py-2.5">
              <div>
                <p className="text-sm font-medium">Sandbox mode</p>
                <p className="text-xs text-muted-foreground">
                  Use the provider&apos;s test environment.
                </p>
              </div>
              <Switch
                checked={newCourier.isSandbox}
                onCheckedChange={(v) =>
                  setNewCourier((s) => ({ ...s, isSandbox: v }))
                }
                aria-label="Sandbox mode"
              />
            </div>
            <div className="flex items-center justify-between rounded-lg border px-3 py-2.5">
              <div>
                <p className="text-sm font-medium">Active</p>
                <p className="text-xs text-muted-foreground">
                  Active providers can be selected for shipments.
                </p>
              </div>
              <Switch
                checked={newCourier.isActive}
                onCheckedChange={(v) =>
                  setNewCourier((s) => ({ ...s, isActive: v }))
                }
                aria-label="Provider active"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setAddOpen(false)}
              disabled={creating}
            >
              Cancel
            </Button>
            <Button onClick={handleCreateCourier} disabled={creating}>
              {creating ? "Adding…" : "Add courier"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Deactivation gate — shared in-app dialog (replaces window.confirm) */}
      <ConfirmDialog
        open={!!pendingDeactivation}
        title="Deactivate courier?"
        description="Are you sure you want to deactivate this courier? No new shipments can be routed through disabled providers."
        confirmLabel="Deactivate"
        cancelLabel="Cancel"
        variant="destructive"
        onConfirm={() => {
          if (pendingDeactivation) handleToggle(pendingDeactivation, false);
        }}
        onCancel={() => setPendingDeactivation(null)}
      />
    </>
  );
}
