import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const PERMISSIONS = [
  { name: "manage_users", description: "Create, update, and delete users" },
  { name: "manage_roles", description: "Create, update, and delete roles and permissions" },
  { name: "view_reports", description: "View performance reports and analytics" },
  { name: "create_tasks", description: "Create new tasks" },
  { name: "manage_tasks", description: "Update and delete any task" },
  { name: "query_ai", description: "Use the AI query interface for performance reports" },
  { name: "view_all_tasks", description: "View tasks of all users" },
  { name: "manage_social_accounts", description: "Link and unlink social accounts for any user" },
  { name: "manage_teams", description: "Create and manage permanent teams and hierarchy" },
  { name: "manage_projects", description: "Create and manage project teams and hierarchy" },
  { name: "manage_verticals", description: "Manage verticals and reassign vertical owners" },
  { name: "manage_content", description: "Create and manage Content, nodes, team, outputs, and resources" },
  { name: "approve_resources", description: "Approve / reject Content node outputs" },
  { name: "manage_ideation", description: "Create ideas and view collaborator recommendations" },
  {
    name: "approve_rental_resources",
    description: "Approve / reject rental resource requests on content nodes (vertical heads + admins)"
  }
];

const ROLES: { name: string; description: string; permissions: string[] }[] = [
  {
    name: "superadmin",
    description: "Super Admin with full access including vertical owner reassignment",
    permissions: PERMISSIONS.map((p) => p.name)
  },
  {
    name: "admin",
    description: "Full system access",
    permissions: PERMISSIONS.filter((p) => p.name !== "manage_verticals").map((p) => p.name)
  },
  {
    name: "chief_of_staff",
    description: "Chief Of Staff with admin-level access",
    permissions: PERMISSIONS.filter((p) => p.name !== "manage_verticals").map((p) => p.name)
  },
  {
    name: "manager",
    description: "Can view reports, query AI, and manage tasks",
    permissions: [
      "view_reports",
      "create_tasks",
      "manage_tasks",
      "query_ai",
      "view_all_tasks",
      "manage_social_accounts",
      "manage_teams",
      "manage_projects",
      "manage_content",
      "approve_resources",
      "manage_ideation"
    ]
  },
  {
    name: "content_creator",
    description: "Can create and manage own tasks and query AI",
    permissions: ["create_tasks", "manage_ideation", "query_ai"]
  }
];

const ADMIN_EMAIL = "admin@bran.app";
const ADMIN_PASSWORD = "admin@123";

const VERTICALS = [
  {
    slug: "fiction",
    name: "Fiction",
    description: "Fiction vertical: stories, novels, and creative narratives."
  },
  {
    slug: "non-fiction",
    name: "Non Fiction",
    description: "Non Fiction vertical: factual content, education, journalism."
  }
];

async function main() {
  console.log("Seeding permissions...");
  const permissionRecords: Record<string, string> = {};

  for (const perm of PERMISSIONS) {
    const record = await prisma.permission.upsert({
      where: { name: perm.name },
      update: { description: perm.description },
      create: perm
    });
    permissionRecords[record.name] = record.id;
    console.log(`  Permission: ${record.name} (${record.id})`);
  }

  console.log("\nSeeding roles...");
  const roleRecords: Record<string, string> = {};

  for (const roleDef of ROLES) {
    const role = await prisma.role.upsert({
      where: { name: roleDef.name },
      update: { description: roleDef.description },
      create: { name: roleDef.name, description: roleDef.description }
    });
    roleRecords[role.name] = role.id;
    console.log(`  Role: ${role.name} (${role.id})`);

    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });

    const assignments = roleDef.permissions
      .filter((pName) => permissionRecords[pName])
      .map((pName) => ({
        roleId: role.id,
        permissionId: permissionRecords[pName]
      }));

    if (assignments.length > 0) {
      await prisma.rolePermission.createMany({ data: assignments });
    }

    console.log(`    Assigned ${assignments.length} permissions`);
  }

  console.log("\nSeeding admin user...");
  const adminRoleId = roleRecords["admin"];
  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12);

  const admin = await prisma.user.upsert({
    where: { email: ADMIN_EMAIL },
    update: { passwordHash, roleId: adminRoleId, isActive: true },
    create: {
      email: ADMIN_EMAIL,
      name: "Admin",
      passwordHash,
      roleId: adminRoleId,
      isActive: true
    }
  });

  console.log(`  Admin user: ${admin.email} (${admin.id})`);
  console.log(`  Password: ${ADMIN_PASSWORD}`);

  console.log("\nSeeding verticals (owners will be assigned later)...");
  for (const v of VERTICALS) {
    const vertical = await prisma.vertical.upsert({
      where: { slug: v.slug },
      update: { name: v.name, description: v.description },
      create: {
        slug: v.slug,
        name: v.name,
        description: v.description
      }
    });
    const ownerLabel = vertical.ownerUserId ?? "unassigned";
    console.log(`  Vertical: ${vertical.name} (${vertical.id}) -> owner ${ownerLabel}`);
  }

  console.log("\nSeed complete.");
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error("Seed failed:", e);
    prisma.$disconnect();
    process.exit(1);
  });
