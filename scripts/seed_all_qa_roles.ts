import { randomBytes } from "crypto";
import { prisma } from '../lib/prisma';

/**
 * QA role accounts seeded by this script.
 *
 * REG-59: this list previously carried one shared, hardcoded password
 * for every account — including SUPERADMIN — committed to the repo. If
 * the seeder was ever run against production, every seeded account had
 * a publicly-known password. Passwords are now resolved per run:
 *
 *   1. QA_PASSWORD_<EMAIL_LOCAL_PART> env var for that account
 *      (e.g. QA_PASSWORD_QA_SUPERADMIN), or
 *   2. the shared QA_SEED_PASSWORD env var, or
 *   3. a freshly generated per-account password, printed ONCE at the
 *      start of the run (store it in a password manager immediately —
 *      it is never printed again and never stored in the repo).
 */
export const QA_USERS = [
  {
    roleName: "SUPERADMIN",
    email: "qa_superadmin@anchorfashion.com",
    firstName: "QA",
    lastName: "SuperAdmin",
    phone: "+8801700000001",
  },
  {
    roleName: "ADMIN",
    email: "qa_admin@anchorfashion.com",
    firstName: "QA",
    lastName: "Admin",
    phone: "+8801700000002",
  },
  {
    roleName: "MANAGER",
    email: "qa_manager@anchorfashion.com",
    firstName: "QA",
    lastName: "Manager",
    phone: "+8801700000003",
  },
  {
    roleName: "WAREHOUSE_MANAGER",
    email: "qa_warehouse@anchorfashion.com",
    firstName: "QA",
    lastName: "Warehouse",
    phone: "+8801700000004",
  },
  {
    roleName: "MARKETING_MANAGER",
    email: "qa_marketing_mgr@anchorfashion.com",
    firstName: "QA",
    lastName: "MarketingMgr",
    phone: "+8801700000005",
  },
  {
    roleName: "FINANCE_MANAGER",
    email: "qa_finance_mgr@anchorfashion.com",
    firstName: "QA",
    lastName: "FinanceMgr",
    phone: "+8801700000006",
  },
  {
    roleName: "MARKETING",
    email: "qa_marketing@anchorfashion.com",
    firstName: "QA",
    lastName: "Marketing",
    phone: "+8801700000007",
  },
  {
    roleName: "STAFF",
    email: "qa_staff@anchorfashion.com",
    firstName: "QA",
    lastName: "Staff",
    phone: "+8801700000008",
  },
  {
    roleName: "SUPPORT",
    email: "qa_support@anchorfashion.com",
    firstName: "QA",
    lastName: "Support",
    phone: "+8801700000009",
  },
  {
    roleName: "CUSTOMER",
    email: "qa_customer@anchorfashion.com",
    firstName: "QA",
    lastName: "Customer",
    phone: "+8801700000010",
  },
];

/** Generates a strong one-off password (mixed classes, ~27 chars). */
function generateQaPassword(): string {
  return `Qa!${randomBytes(18).toString("base64url")}9x`;
}

/** Env-provided password for one QA account, or undefined when unset. */
function qaPasswordFromEnv(email: string): string | undefined {
  const localPart = email.split("@")[0].toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  return process.env[`QA_PASSWORD_${localPart}`] || process.env.QA_SEED_PASSWORD;
}

/**
 * Password lookup for the QA test suites: they can only use passwords
 * the operator provided via env (a generated seed password is printed
 * once and known to no file). Throws a clear error when unset so a
 * suite never silently signs in with a wrong/shared credential.
 */
export function getQaPassword(email: string): string {
  const password = qaPasswordFromEnv(email);
  if (!password) {
    throw new Error(
      `No QA password configured for ${email}. Set QA_PASSWORD_<ACCOUNT> or QA_SEED_PASSWORD to the password used when seeding.`
    );
  }
  return password;
}

/**
 * Resolves the password for every QA account for this run (see the
 * REG-59 note above). Generated passwords are printed exactly once.
 */
function resolveQaPasswords(): Map<string, string> {
  const passwords = new Map<string, string>();
  const generated: Array<{ email: string; password: string }> = [];

  for (const u of QA_USERS) {
    const fromEnv = qaPasswordFromEnv(u.email);
    if (fromEnv) {
      passwords.set(u.email, fromEnv);
    } else {
      const password = generateQaPassword();
      passwords.set(u.email, password);
      generated.push({ email: u.email, password });
    }
  }

  if (generated.length > 0) {
    console.log("\n=== GENERATED QA PASSWORDS — SHOWN ONCE, STORE THEM NOW ===");
    for (const g of generated) {
      console.log(`  ${g.email}  ->  ${g.password}`);
    }
    console.log("=== (Set QA_PASSWORD_<ACCOUNT> or QA_SEED_PASSWORD env vars to choose your own.) ===\n");
  }

  return passwords;
}

async function setupAccounts() {
  const passwordByEmail = resolveQaPasswords();

  console.log("=== STEP 1: VERIFY ROLES IN DATABASE ===");
  const allRoles = await prisma.role.findMany();
  const roleMap = new Map(allRoles.map(r => [r.name.toUpperCase(), r.id]));

  for (const u of QA_USERS) {
    if (!roleMap.has(u.roleName.toUpperCase())) {
      console.log(`Creating missing role: ${u.roleName}`);
      const newRole = await prisma.role.create({
        data: {
          name: u.roleName,
          description: `System role for ${u.roleName}`,
          isSystem: true,
        },
      });
      roleMap.set(u.roleName.toUpperCase(), newRole.id);
    }
  }

  console.log("=== STEP 2: CREATE NEON AUTH ACCOUNTS & PRISMA PROFILES ===");
  for (const u of QA_USERS) {
    console.log(`\nProcessing ${u.roleName}: ${u.email}...`);

    let userId: string | null = null;

    // 2a. Call Neon Auth Sign Up
    try {
      const res = await fetch("http://localhost:3000/api/auth/sign-up/email", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Origin": "http://localhost:3000",
        },
        body: JSON.stringify({
          email: u.email,
          password: passwordByEmail.get(u.email),
          name: `${u.firstName} ${u.lastName}`,
        }),
      });

      const body: any = await res.json().catch(() => null);
      if (res.ok && body?.user?.id) {
        userId = body.user.id;
        console.log(`  -> Neon Auth created user ID: ${userId}`);
      } else {
        console.log(`  -> Sign-up response (${res.status}):`, body?.message || body?.error || "Already exists or error");
      }
    } catch (err: any) {
      console.log(`  -> Sign-up request error:`, err.message);
    }

    // 2b. If sign-up returned already exists or didn't return user, try sign-in to get user id
    if (!userId) {
      try {
        const signinRes = await fetch("http://localhost:3000/api/auth/sign-in/email", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Origin": "http://localhost:3000",
          },
          body: JSON.stringify({
            email: u.email,
            password: passwordByEmail.get(u.email),
          }),
        });
        const signinBody: any = await signinRes.json().catch(() => null);
        if (signinRes.ok && signinBody?.user?.id) {
          userId = signinBody.user.id;
          console.log(`  -> Neon Auth sign-in resolved user ID: ${userId}`);
        }
      } catch (err: any) {
        console.log(`  -> Sign-in check error:`, err.message);
      }
    }

    // 2c. Upsert Prisma Profile
    const roleId = roleMap.get(u.roleName.toUpperCase());
    const existingProfile = await prisma.profile.findFirst({
      where: {
        OR: [
          ...(userId ? [{ id: userId }] : []),
          { email: u.email },
        ],
      },
    });

    if (existingProfile) {
      const updated = await prisma.profile.update({
        where: { id: existingProfile.id },
        data: {
          roleId,
          firstName: u.firstName,
          lastName: u.lastName,
          phone: u.phone,
          isActive: true,
          email: u.email,
        },
      });
      console.log(`  -> Updated existing Profile: ${updated.id} with role ${u.roleName}`);
    } else {
      const created = await prisma.profile.create({
        data: {
          ...(userId ? { id: userId } : {}),
          email: u.email,
          firstName: u.firstName,
          lastName: u.lastName,
          phone: u.phone,
          roleId,
          isActive: true,
        },
      });
      console.log(`  -> Created new Profile: ${created.id} with role ${u.roleName}`);
    }
  }

  console.log("\n=== STEP 3: VERIFY ALL PROFILES IN DB ===");
  const profiles = await prisma.profile.findMany({
    where: {
      email: { in: QA_USERS.map(u => u.email) }
    },
    include: { role: true }
  });

  for (const p of profiles) {
    console.log(`Profile: ${p.email} | Name: ${p.firstName} ${p.lastName} | Role: ${p.role?.name} | Active: ${p.isActive}`);
  }
}

if (require.main === module) {
  setupAccounts().catch(console.error).finally(() => prisma.$disconnect());
}
