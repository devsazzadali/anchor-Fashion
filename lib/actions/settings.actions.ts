"use server";

import { createDbClient } from "@/lib/db/client";
import { createAdminDbClient } from "@/lib/db/client";
import { verifySuperAdmin } from "../security/roles";
import { revalidatePath, revalidateTag, unstable_cache } from "next/cache";
import {
  recordAuditForSessionUser,
  AUDIT_ACTIONS,
} from "@/lib/security/audit";

/** REG-27: every settings write is audited with its settings key. */
async function auditSettingsChange(key: string) {
  await recordAuditForSessionUser({
    action: AUDIT_ACTIONS.SETTINGS_UPDATED,
    entity: "settings",
    entityId: key,
    newValues: { key },
  });
}

export type StoreInfo = {
  store_name: string;
  store_description: string;
  phone: string;
  email: string;
  address: string;
  announcement_bar: string;
  free_shipping_threshold: string;
};

export type SocialLinks = {
  facebook: string;
  instagram: string;
  twitter: string;
  youtube: string;
  tiktok: string;
};

export type StoreConfig = {
  store_name: string;
  currency: string;
  timezone: string;
  weight_unit: string;
};

export type SeoSettings = {
  meta_title: string;
  meta_description: string;
  social_image: string;
  keywords?: string;
};

export type SecuritySettingsConfig = {
  two_factor_required: boolean;
  strict_password_policy: boolean;
  auto_session_timeout: boolean;
};

export type EmailSettingsConfig = {
  sender_name: string;
  sender_email: string;
  smtp_host: string;
  smtp_port: string;
};

export type AnalyticsSettingsConfig = {
  ga_id: string;
  gtm_id: string;
  fb_pixel: string;
};

/**
 * Company / invoice identity shown on the Mushak-6.3 invoice
 * (InvoiceSheet header + footer, print views, public invoice page and the
 * completion email). Admin-editable under Settings → Invoice & Company.
 * Defaults are the values that were previously hardcoded in the invoice
 * component, so rendering is unchanged until an admin edits them.
 */
export type InvoiceInfo = {
  company_name: string;
  central_bin: string;
  central_address: string;
  web_address: string;
  customer_care: string;
  shop_concern: string;
  email: string;
  system_by: string;
};

const DEFAULTS: {
  store_info: StoreInfo;
  social_links: SocialLinks;
  store_config: StoreConfig;
  seo_settings: SeoSettings;
  security_settings: SecuritySettingsConfig;
  email_settings: EmailSettingsConfig;
  analytics_settings: AnalyticsSettingsConfig;
  invoice_info: InvoiceInfo;
} = {
  store_info: {
    store_name: "Anchor Fashion Enterprise",
    store_description:
      "Premium apparel for the modern professional. Elevate your wardrobe with our carefully curated collections.",
    phone: "+880 1711-223344",
    email: "support@anchorfashion.com",
    address: "Dhaka, Bangladesh",
    announcement_bar:
      "🚚 Free Shipping On Orders Over ৳999 | Easy Returns & Exchanges",
    free_shipping_threshold: "999",
  },
  social_links: {
    facebook: "#",
    instagram: "#",
    twitter: "#",
    youtube: "#",
    tiktok: "#",
  },
  store_config: {
    store_name: "Anchor Fashion",
    currency: "BDT (৳)",
    timezone: "Asia/Dhaka (GMT+6)",
    weight_unit: "kg",
  },
  seo_settings: {
    meta_title: "Anchor Fashion | Premium Clothing Brand",
    meta_description:
      "Discover the latest trends in fashion at Anchor Fashion. Shop premium clothing and accessories.",
    social_image: "https://anchorfashion.com/og-image.jpg",
    keywords: "fashion, clothing, anchor fashion, bangladesh, apparel",
  },
  security_settings: {
    two_factor_required: false,
    strict_password_policy: true,
    auto_session_timeout: true,
  },
  email_settings: {
    sender_name: "Anchor Fashion Support",
    sender_email: "noreply@anchorfashion.com",
    smtp_host: "smtp.mailgun.org",
    smtp_port: "587",
  },
  analytics_settings: {
    ga_id: "",
    gtm_id: "",
    fb_pixel: "",
  },
  invoice_info: {
    company_name: "Anchor Fashion Ltd",
    central_bin: "001168309-0101",
    central_address: "Plot No# 01, Section #07, Mirpur - 1216, Dhaka",
    web_address: "anchorfashion.com",
    customer_care: "+8801885598889",
    shop_concern: "+8801885813370",
    email: "info@anchorfashion.com",
    system_by: "Anchor Fashion Ltd.",
  },
};

const getCachedSetting = unstable_cache(
  async (key: string, defaultValue: any): Promise<any> => {
    try {
      const db = await createDbClient();
      const { data } = await db
        .from("settings")
        .select("value")
        .eq("key", key)
        .single();
      if (data?.value && typeof data.value === "object") {
        return { ...defaultValue, ...(data.value as any) };
      }
      return (data?.value as any) ?? defaultValue;
    } catch {
      return defaultValue;
    }
  },
  ["global-settings-cache"],
  { tags: ["settings"], revalidate: 300 }
);

export async function getStoreInfo(): Promise<StoreInfo> {
  return getCachedSetting("store_info", DEFAULTS.store_info);
}

/**
 * REG-29 + REG-52: ONE source of truth for identity + contacts.
 *
 * Canonical store identity/contacts live in `store_info`
 * (store_name, email, phone, address) — the same row the storefront
 * header/footer, checkout, and contact page already read. The invoice
 * previously carried its OWN contact email/phone in `invoice_info`,
 * which had drifted apart (info@ / +8801885598889 on the invoice vs
 * support@ / +880 1711-223344 in the header). getInvoiceInfo now takes
 * the contact fields (email, customer_care) from the canonical
 * store_info; `invoice_info` keeps only the invoice-legal identity —
 * company_name (the legal "Anchor Fashion Ltd"), central_bin,
 * central_address, web_address, shop_concern, system_by.
 */
export async function getInvoiceInfo(): Promise<InvoiceInfo> {
  const [invoiceInfo, storeInfo] = await Promise.all([
    getCachedSetting("invoice_info", DEFAULTS.invoice_info) as Promise<InvoiceInfo>,
    getStoreInfo(),
  ]);
  return {
    ...invoiceInfo,
    email: storeInfo.email,
    customer_care: storeInfo.phone,
  };
}

export async function updateInvoiceInfo(info: InvoiceInfo) {
  try {
    await verifySuperAdmin(); // Enforce strict role-based access
    const db = createAdminDbClient(); // Bypass RLS securely for writing settings

    // REG-29: contact email / customer-care phone are canonical in
    // store_info (edited under General Settings) — never persist a
    // divergent copy here.
    const { email: _email, customer_care: _customerCare, ...legalInfo } = info;

    const { error } = await db
      .from("settings")
      .upsert(
        {
          key: "invoice_info",
          value: legalInfo as any,
          description: "Legal company identity printed on invoices (name, BIN, address). Contacts come from store_info.",
        },
        { onConflict: "key" }
      );

    if (error) throw error;

    await auditSettingsChange("invoice_info");

    try {
      revalidateTag("settings", "max");
      revalidatePath("/admin/settings/invoice");
    } catch {}
    return { success: true };
  } catch (error: any) {
    console.error("[updateInvoiceInfo]", error);
    return { success: false, error: error.message };
  }
}

export async function getSocialLinks(): Promise<SocialLinks> {
  return getCachedSetting("social_links", DEFAULTS.social_links);
}

export async function updateStoreInfo(info: StoreInfo) {
  try {
    await verifySuperAdmin(); // Enforce strict role-based access
    const db = createAdminDbClient(); // Bypass RLS securely for writing settings

    const { error } = await db
      .from("settings")
      .upsert(
        {
          key: "store_info",
          value: info as any,
          description: "Global store contact and branding info",
        },
        { onConflict: "key" }
      );
      
    if (error) throw error;

    await auditSettingsChange("store_info");
    
    try {
      revalidateTag("settings", "max");
      revalidatePath("/", "layout");
    } catch {}
    return { success: true };
  } catch (error: any) {
    console.error("[updateStoreInfo]", error);
    return { success: false, error: error.message };
  }
}

export async function updateSocialLinks(links: SocialLinks) {
  try {
    await verifySuperAdmin(); // Enforce strict role-based access
    const db = createAdminDbClient(); // Bypass RLS securely for writing settings

    const { error } = await db
      .from("settings")
      .upsert(
        {
          key: "social_links",
          value: links as any,
          description: "Store social media profile URLs",
        },
        { onConflict: "key" }
      );
      
    if (error) throw error;

    await auditSettingsChange("social_links");
    
    try {
      revalidateTag("settings", "max");
      revalidatePath("/", "layout");
    } catch {}
    return { success: true };
  } catch (error: any) {
    console.error("[updateSocialLinks]", error);
    return { success: false, error: error.message };
  }
}

export async function getStoreConfig(): Promise<StoreConfig> {
  // REG-29: the store NAME is canonical in store_info — Store Settings
  // and General Settings used to keep two different names ("Anchor
  // Fashion" here vs "Anchor Fashion Enterprise" in store_info). The
  // name served from this getter is always the canonical one;
  // store_config keeps only operational config (currency, timezone,
  // weight unit).
  const [config, storeInfo] = await Promise.all([
    getCachedSetting("store_config", DEFAULTS.store_config) as Promise<StoreConfig>,
    getStoreInfo(),
  ]);
  return { ...config, store_name: storeInfo.store_name };
}

export async function updateStoreConfig(config: StoreConfig) {
  try {
    await verifySuperAdmin();
    const db = createAdminDbClient();

    const { error } = await db
      .from("settings")
      .upsert(
        {
          key: "store_config",
          value: config as any,
          description: "Global store configuration",
        },
        { onConflict: "key" }
      );

    if (error) throw error;

    // REG-29: mirror the name into the canonical store_info row so
    // editing the name here updates the one value the storefront,
    // invoices, and General Settings all read. Read fresh (not the
    // cache) so no other store_info field is reverted.
    try {
      const { data: currentInfoRow } = await db
        .from("settings")
        .select("value")
        .eq("key", "store_info")
        .single();
      const currentInfo = {
        ...DEFAULTS.store_info,
        ...((currentInfoRow?.value as any) || {}),
      };
      if (config.store_name && config.store_name !== currentInfo.store_name) {
        await db.from("settings").upsert(
          {
            key: "store_info",
            value: { ...currentInfo, store_name: config.store_name } as any,
            description: "Global store contact and branding info",
          },
          { onConflict: "key" }
        );
      }
    } catch (mirrorErr) {
      console.error("[updateStoreConfig] store_name mirror failed:", mirrorErr);
    }

    await auditSettingsChange("store_config");
    try {
      revalidateTag("settings", "max");
      revalidatePath("/admin/settings/store");
      revalidatePath("/", "layout");
    } catch {}
    return { success: true };
  } catch (error: any) {
    console.error("[updateStoreConfig]", error);
    return { success: false, error: error.message };
  }
}

export async function getSeoSettings(): Promise<SeoSettings> {
  return getCachedSetting("seo_settings", DEFAULTS.seo_settings);
}

export async function updateSeoSettings(settings: SeoSettings) {
  try {
    await verifySuperAdmin();
    const db = createAdminDbClient();

    const { error } = await db
      .from("settings")
      .upsert(
        {
          key: "seo_settings",
          value: settings as any,
          description: "Default SEO and Meta tag configuration",
        },
        { onConflict: "key" }
      );

    if (error) throw error;

    await auditSettingsChange("seo_settings");

    try {
      revalidateTag("settings", "max");
      revalidatePath("/", "layout");
      revalidatePath("/admin/settings/seo");
    } catch {}
    return { success: true };
  } catch (error: any) {
    console.error("[updateSeoSettings]", error);
    return { success: false, error: error.message };
  }
}

export async function getSecuritySettings(): Promise<SecuritySettingsConfig> {
  const db = await createDbClient();
  try {
    const { data } = await db
      .from("settings")
      .select("value")
      .eq("key", "security_settings")
      .single();
    return (data?.value as SecuritySettingsConfig) ?? DEFAULTS.security_settings;
  } catch {
    return DEFAULTS.security_settings;
  }
}

export async function updateSecuritySettings(config: SecuritySettingsConfig) {
  try {
    await verifySuperAdmin();
    const db = createAdminDbClient();

    const { error } = await db
      .from("settings")
      .upsert(
        {
          key: "security_settings",
          value: config as any,
          description: "Security and authentication policies",
        },
        { onConflict: "key" }
      );

    if (error) throw error;

    await auditSettingsChange("security_settings");

    revalidatePath("/admin/settings/security");
    return { success: true };
  } catch (error: any) {
    console.error("[updateSecuritySettings]", error);
    return { success: false, error: error.message };
  }
}

export async function getEmailSettings(): Promise<EmailSettingsConfig> {
  const db = await createDbClient();
  try {
    const { data } = await db
      .from("settings")
      .select("value")
      .eq("key", "email_settings")
      .single();
    return (data?.value as EmailSettingsConfig) ?? DEFAULTS.email_settings;
  } catch {
    return DEFAULTS.email_settings;
  }
}

export async function updateEmailSettings(config: EmailSettingsConfig) {
  try {
    await verifySuperAdmin();
    const db = createAdminDbClient();

    const { error } = await db
      .from("settings")
      .upsert(
        {
          key: "email_settings",
          value: config as any,
          description: "Outgoing email SMTP configuration",
        },
        { onConflict: "key" }
      );

    if (error) throw error;

    await auditSettingsChange("email_settings");

    revalidatePath("/admin/settings/email");
    return { success: true };
  } catch (error: any) {
    console.error("[updateEmailSettings]", error);
    return { success: false, error: error.message };
  }
}

export async function getAnalyticsSettings(): Promise<AnalyticsSettingsConfig> {
  const db = await createDbClient();
  try {
    const { data } = await db
      .from("settings")
      .select("value")
      .eq("key", "analytics_settings")
      .single();
    return (data?.value as AnalyticsSettingsConfig) ?? DEFAULTS.analytics_settings;
  } catch {
    return DEFAULTS.analytics_settings;
  }
}

export async function updateAnalyticsSettings(config: AnalyticsSettingsConfig) {
  try {
    await verifySuperAdmin();
    const db = createAdminDbClient();

    const { error } = await db
      .from("settings")
      .upsert(
        {
          key: "analytics_settings",
          value: config as any,
          description: "Third-party analytics and tracking IDs",
        },
        { onConflict: "key" }
      );

    if (error) throw error;

    await auditSettingsChange("analytics_settings");

    revalidatePath("/admin/settings/analytics");
    revalidatePath("/", "layout");
    return { success: true };
  } catch (error: any) {
    console.error("[updateAnalyticsSettings]", error);
    return { success: false, error: error.message };
  }
}
