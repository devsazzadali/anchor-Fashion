"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  updateFeaturesBarConfig,
  updateHomepageLayout,
} from "@/lib/actions/homepage.actions";
import {
  HOMEPAGE_SECTIONS,
  type FeaturesBarConfig,
  type HomepageLayout,
} from "@/lib/homepage-shared";

const ICON_OPTIONS = [
  "Truck",
  "RotateCcw",
  "Award",
  "ShieldCheck",
  "CreditCard",
  "PackageCheck",
  "Sparkles",
  "Headset",
];

export default function HomepageManagerClient({
  initialLayout,
  initialFeatures,
}: {
  initialLayout: HomepageLayout;
  initialFeatures: FeaturesBarConfig;
}) {
  const router = useRouter();
  const [layout, setLayout] = useState<HomepageLayout>(initialLayout);
  const [features, setFeatures] = useState<FeaturesBarConfig>(initialFeatures);
  const [saving, setSaving] = useState(false);

  const meta = (key: string) => HOMEPAGE_SECTIONS.find((s) => s.key === key);

  const move = (group: "top" | "main", key: string, dir: -1 | 1) => {
    setLayout((prev) => {
      const groupKeys = HOMEPAGE_SECTIONS.filter((s) => s.group === group).map(
        (s) => s.key
      );
      const groupItems = prev.sections.filter((s) => groupKeys.includes(s.key));
      const others = prev.sections.filter((s) => !groupKeys.includes(s.key));
      const idx = groupItems.findIndex((s) => s.key === key);
      const swap = idx + dir;
      if (idx < 0 || swap < 0 || swap >= groupItems.length) return prev;
      const next = [...groupItems];
      [next[idx], next[swap]] = [next[swap], next[idx]];
      // Preserve global structure: top group first, then main group.
      const top = group === "top" ? next : prev.sections.filter((s) => HOMEPAGE_SECTIONS.find((m) => m.key === s.key)?.group === "top");
      const main = group === "main" ? next : prev.sections.filter((s) => HOMEPAGE_SECTIONS.find((m) => m.key === s.key)?.group === "main");
      void others;
      return { sections: [...top, ...main] };
    });
  };

  const toggle = (key: string, v: boolean) =>
    setLayout((prev) => ({
      sections: prev.sections.map((s) =>
        s.key === key ? { ...s, isEnabled: v } : s
      ),
    }));

  const handleSave = async () => {
    setSaving(true);
    try {
      const [a, b] = await Promise.all([
        updateHomepageLayout(layout),
        updateFeaturesBarConfig(features),
      ]);
      if (!a.success) throw new Error(a.error || "Layout save failed");
      if (!b.success) throw new Error(b.error || "Features save failed");
      toast.success("Homepage settings saved");
      router.refresh();
    } catch (e: any) {
      toast.error(e.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const renderGroup = (group: "top" | "main", title: string, hint: string) => {
    const items = layout.sections.filter(
      (s) => meta(s.key)?.group === group
    );
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{title}</CardTitle>
          <CardDescription>{hint}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {items.map((s, i) => (
            <div
              key={s.key}
              className="flex items-center gap-3 rounded-md border border-border px-3 py-2.5"
            >
              <div className="flex flex-col">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5"
                  disabled={i === 0}
                  onClick={() => move(group, s.key, -1)}
                  aria-label="Move up"
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5"
                  disabled={i === items.length - 1}
                  onClick={() => move(group, s.key, 1)}
                  aria-label="Move down"
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                </Button>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{meta(s.key)?.label || s.key}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {meta(s.key)?.description}
                </p>
              </div>
              <Switch
                checked={s.isEnabled !== false}
                onCheckedChange={(v) => toggle(s.key, v)}
                aria-label={`Toggle ${meta(s.key)?.label || s.key}`}
              />
            </div>
          ))}
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Homepage Manager</h1>
          <p className="text-sm text-muted-foreground">
            Control which sections appear on the homepage, their order, and
            the Features Bar content. Section content itself is edited in its
            own CMS module (Banners, Curated Categories, Why Choose Us…).
          </p>
        </div>
        <Button onClick={handleSave} disabled={saving}>
          {saving ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Save className="mr-2 h-4 w-4" />
          )}
          Save Homepage Settings
        </Button>
      </div>

      {renderGroup(
        "top",
        "Top Sections (under the hero)",
        "Rendered directly below the hero slider, in this order."
      )}
      {renderGroup(
        "main",
        "Main Sections",
        "Rendered in the main page column, in this order."
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base">Features Bar</CardTitle>
              <CardDescription>
                The service-guarantees strip (Free Delivery, Easy Returns…).
                Up to 4 items.
              </CardDescription>
            </div>
            <Switch
              checked={features.isEnabled !== false}
              onCheckedChange={(v) =>
                setFeatures((f) => ({ ...f, isEnabled: v }))
              }
              aria-label="Toggle features bar"
            />
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {features.items.map((item, i) => (
            <div
              key={i}
              className="grid grid-cols-1 gap-2 rounded-md border border-border p-3 sm:grid-cols-[160px_1fr_1fr]"
            >
              <label className="space-y-1">
                <span className="text-xs font-medium text-muted-foreground">Icon</span>
                <select
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                  value={item.icon}
                  onChange={(e) =>
                    setFeatures((f) => ({
                      ...f,
                      items: f.items.map((it, j) =>
                        j === i ? { ...it, icon: e.target.value } : it
                      ),
                    }))
                  }
                >
                  {ICON_OPTIONS.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-xs font-medium text-muted-foreground">Title</span>
                <Input
                  value={item.title}
                  onChange={(e) =>
                    setFeatures((f) => ({
                      ...f,
                      items: f.items.map((it, j) =>
                        j === i ? { ...it, title: e.target.value } : it
                      ),
                    }))
                  }
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-medium text-muted-foreground">Description</span>
                <Input
                  value={item.description}
                  onChange={(e) =>
                    setFeatures((f) => ({
                      ...f,
                      items: f.items.map((it, j) =>
                        j === i ? { ...it, description: e.target.value } : it
                      ),
                    }))
                  }
                />
              </label>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
