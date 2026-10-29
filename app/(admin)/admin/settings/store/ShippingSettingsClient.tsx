"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import {
  createZoneAction,
  updateZoneAction,
  deleteZoneAction,
  type AdminZone,
  type ZoneInput,
} from "@/lib/actions/shipping.actions";
import {
  Save,
  Truck,
  MapPin,
  Plus,
  Pencil,
  Trash2,
  Star,
  Loader2,
  X,
} from "lucide-react";

interface ShippingSettingsClientProps {
  zones: AdminZone[];
}

type Draft = ZoneInput & { id?: string };

const emptyDraft: Draft = {
  name: "",
  code: "",
  rate: 0,
  districts: [],
  is_default: false,
  is_active: true,
  sort_order: 0,
};

export function ShippingSettingsClient({ zones }: ShippingSettingsClientProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [districtsText, setDistrictsText] = useState("");

  const openCreate = () => {
    setDraft({ ...emptyDraft, sort_order: zones.length + 1 });
    setDistrictsText("");
  };

  const openEdit = (zone: AdminZone) => {
    setDraft({
      id: zone.id,
      name: zone.name,
      code: zone.code || "",
      rate: zone.rate,
      districts: zone.districts,
      is_default: zone.is_default,
      is_active: zone.is_active,
      sort_order: zone.sort_order,
    });
    setDistrictsText((zone.districts || []).join(", "));
  };

  const handleSave = () => {
    if (!draft) return;
    const payload: ZoneInput = {
      ...draft,
      districts: districtsText
        .split(",")
        .map((d) => d.trim())
        .filter(Boolean),
    };
    startTransition(async () => {
      const result = draft.id
        ? await updateZoneAction(draft.id, payload)
        : await createZoneAction(payload);
      if (result.success) {
        toast.success(draft.id ? "Zone updated!" : "Zone created!");
        setDraft(null);
        router.refresh();
      } else {
        toast.error(result.error ?? "Failed to save zone.");
      }
    });
  };

  const handleToggleActive = (zone: AdminZone) => {
    startTransition(async () => {
      const result = await updateZoneAction(zone.id, {
        name: zone.name,
        code: zone.code || "",
        rate: zone.rate,
        districts: zone.districts,
        is_default: zone.is_default,
        is_active: !zone.is_active,
        sort_order: zone.sort_order,
      });
      if (result.success) {
        toast.success(`Zone ${!zone.is_active ? "activated" : "deactivated"}.`);
        router.refresh();
      } else {
        toast.error(result.error ?? "Failed to update zone.");
      }
    });
  };

  const handleDelete = (zone: AdminZone) => {
    if (
      !window.confirm(
        `Delete the "${zone.name}" zone permanently? Orders already placed keep their charged amount.`
      )
    )
      return;
    startTransition(async () => {
      const result = await deleteZoneAction(zone.id);
      if (result.success) {
        toast.success("Zone deleted.");
        router.refresh();
      } else {
        toast.error(result.error ?? "Failed to delete zone.");
      }
    });
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary/10 p-2">
              <Truck className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle>Shipping Zones & Rates</CardTitle>
              <CardDescription>
                Define where you deliver and what each area costs. At checkout
                the customer&apos;s district is matched against a zone&apos;s
                district list; anything unmatched is charged the{" "}
                <strong>default zone</strong> rate. Changes apply to new orders
                immediately.
              </CardDescription>
            </div>
          </div>
          <Button size="sm" onClick={openCreate} disabled={isPending}>
            <Plus className="mr-2 h-4 w-4" /> Add Zone
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {zones.length === 0 && !draft && (
          <div className="flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-12 text-muted-foreground">
            <MapPin className="h-8 w-8 opacity-40" />
            <p className="text-sm">
              No delivery zones configured yet. Add your first zone — until
              then checkout falls back to the legacy flat rates (Dhaka ৳100 /
              elsewhere ৳150).
            </p>
          </div>
        )}

        {zones.map((zone) => (
          <div key={zone.id} className="rounded-lg border overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 bg-muted/50 px-5 py-3.5">
              <div className="flex items-center gap-3">
                <MapPin className="h-5 w-5 shrink-0 text-muted-foreground" />
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold">{zone.name}</h3>
                    {zone.is_default && (
                      <Badge className="gap-1">
                        <Star className="h-3 w-3" /> Default
                      </Badge>
                    )}
                    <Badge variant={zone.is_active ? "default" : "outline"}>
                      {zone.is_active ? "Active" : "Inactive"}
                    </Badge>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Code:{" "}
                    <code className="rounded bg-muted px-1">{zone.code}</code> ·
                    Charge:{" "}
                    <strong className="text-foreground">
                      ৳{zone.rate.toLocaleString()}
                    </strong>{" "}
                    · Order: {zone.sort_order}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={zone.is_active}
                  disabled={isPending}
                  onCheckedChange={() => handleToggleActive(zone)}
                  aria-label={`Toggle ${zone.name}`}
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => openEdit(zone)}
                  disabled={isPending}
                >
                  <Pencil className="mr-1.5 h-3.5 w-3.5" /> Edit
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleDelete(zone)}
                  disabled={isPending || zone.is_default}
                  title={
                    zone.is_default
                      ? "The default zone cannot be deleted"
                      : "Delete zone"
                  }
                >
                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                </Button>
              </div>
            </div>
            <div className="flex flex-wrap gap-1 px-5 py-3">
              {zone.is_default ? (
                <span className="text-xs text-muted-foreground">
                  Serves every district not matched by another active zone.
                </span>
              ) : zone.districts.length > 0 ? (
                zone.districts.map((d) => (
                  <Badge key={d} variant="secondary" className="text-xs">
                    {d}
                  </Badge>
                ))
              ) : (
                <span className="text-xs text-muted-foreground">
                  No districts assigned — this zone only matches nothing until
                  districts are added.
                </span>
              )}
            </div>
          </div>
        ))}

        {draft && (
          <div className="space-y-4 rounded-lg border bg-muted/30 p-5">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">
                {draft.id ? `Edit Zone — ${draft.name}` : "New Delivery Zone"}
              </p>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setDraft(null)}
                aria-label="Close editor"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div className="space-y-1.5">
                <Label>Zone Name</Label>
                <Input
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  placeholder="e.g. Inside Dhaka"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Code</Label>
                <Input
                  value={draft.code}
                  onChange={(e) => setDraft({ ...draft, code: e.target.value })}
                  placeholder="e.g. INSIDE_DHAKA"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Delivery Charge (৳)</Label>
                <Input
                  type="number"
                  min={0}
                  value={draft.rate}
                  onChange={(e) =>
                    setDraft({ ...draft, rate: parseFloat(e.target.value) || 0 })
                  }
                  placeholder="100"
                />
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label>Districts Covered (comma separated)</Label>
                <Input
                  value={districtsText}
                  onChange={(e) => setDistrictsText(e.target.value)}
                  placeholder="e.g. Dhaka, Gazipur, Narayanganj"
                />
                <p className="text-xs text-muted-foreground">
                  Leave empty for the default zone — it catches every address
                  no other zone matches.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label>Sort Order</Label>
                <Input
                  type="number"
                  value={draft.sort_order}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      sort_order: parseInt(e.target.value) || 0,
                    })
                  }
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-6">
              <label className="flex items-center gap-2 text-sm">
                <Switch
                  checked={draft.is_active}
                  onCheckedChange={(v) => setDraft({ ...draft, is_active: v })}
                />
                Active
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Switch
                  checked={draft.is_default}
                  onCheckedChange={(v) => setDraft({ ...draft, is_default: v })}
                />
                Default zone (fallback for unmatched addresses)
              </label>
              <div className="ml-auto flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setDraft(null)}>
                  Cancel
                </Button>
                <Button size="sm" onClick={handleSave} disabled={isPending}>
                  {isPending ? (
                    <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Save className="mr-2 h-3.5 w-3.5" />
                  )}
                  {isPending ? "Saving..." : "Save Zone"}
                </Button>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
