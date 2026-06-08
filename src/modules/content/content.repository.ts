import { Prisma } from "@prisma/client";

import { prisma } from "../../lib/prisma";

const userPreview = { select: { id: true, name: true, email: true } } as const;

const verticalPreview = {
  select: { id: true, name: true, slug: true, ownerUserId: true }
} as const;

const teamPreview = {
  select: { id: true, name: true, verticalId: true }
} as const;

const resourceInclude = {
  requestedBy: userPreview,
  reviewedBy: userPreview
} satisfies Prisma.ContentNodeResourceInclude;

const nodeInclude = {
  team: {
    include: { user: userPreview },
    orderBy: { createdAt: "asc" as const }
  },
  outputs: {
    include: {
      submittedBy: userPreview,
      reviewedBy: userPreview
    },
    orderBy: [{ version: "desc" as const }, { createdAt: "desc" as const }]
  },
  resources: {
    include: resourceInclude,
    orderBy: { createdAt: "asc" as const }
  }
} satisfies Prisma.ContentNodeInclude;

const contentInclude = {
  createdBy: userPreview,
  team: teamPreview,
  project: {
    select: {
      id: true,
      name: true,
      verticalId: true,
      status: true,
      vertical: verticalPreview
    }
  },
  nodes: {
    include: nodeInclude,
    orderBy: { orderIndex: "asc" as const }
  }
} satisfies Prisma.ContentInclude;

// ── Content ───────────────────────────────────────────────

export async function createContent(data: {
  title: string;
  description?: string;
  type: string;
  status?: string;
  teamId: string;
  projectId: string;
  createdById?: string;
}) {
  return prisma.content.create({
    data,
    include: contentInclude
  });
}

export async function listContents(filters: {
  type?: string;
  status?: string;
  createdById?: string;
  teamId?: string;
  projectId?: string;
  verticalId?: string;
}) {
  return prisma.content.findMany({
    where: {
      ...(filters.type ? { type: filters.type } : {}),
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.createdById ? { createdById: filters.createdById } : {}),
      ...(filters.teamId ? { teamId: filters.teamId } : {}),
      ...(filters.projectId ? { projectId: filters.projectId } : {}),
      ...(filters.verticalId ? { project: { verticalId: filters.verticalId } } : {})
    },
    include: contentInclude,
    orderBy: { createdAt: "desc" }
  });
}

export async function getContentById(id: string) {
  return prisma.content.findUnique({
    where: { id },
    include: contentInclude
  });
}

export async function updateContent(
  id: string,
  data: {
    title?: string;
    description?: string | null;
    type?: string;
    status?: string;
    teamId?: string;
    projectId?: string;
  }
) {
  return prisma.content.update({
    where: { id },
    data,
    include: contentInclude
  });
}

export async function deleteContent(id: string) {
  return prisma.content.delete({ where: { id } });
}

// ── Nodes ─────────────────────────────────────────────────

export async function createNode(data: {
  contentId: string;
  kind: string;
  name: string;
  orderIndex: number;
  notes?: string;
  startsAt?: Date;
  dueDate?: Date;
}) {
  return prisma.contentNode.create({
    data,
    include: nodeInclude
  });
}

export async function getNodeById(nodeId: string) {
  return prisma.contentNode.findUnique({
    where: { id: nodeId },
    include: nodeInclude
  });
}

export async function getMaxOrderIndexForContent(contentId: string): Promise<number | null> {
  const result = await prisma.contentNode.aggregate({
    where: { contentId },
    _max: { orderIndex: true }
  });
  return result._max.orderIndex;
}

export async function getNodeByContentAndOrder(contentId: string, orderIndex: number) {
  return prisma.contentNode.findUnique({
    where: { contentId_orderIndex: { contentId, orderIndex } },
    include: nodeInclude
  });
}

export async function updateNode(
  nodeId: string,
  data: {
    kind?: string;
    name?: string;
    orderIndex?: number;
    status?: string;
    notes?: string | null;
    startsAt?: Date | null;
    dueDate?: Date | null;
    completedAt?: Date | null;
  }
) {
  return prisma.contentNode.update({
    where: { id: nodeId },
    data,
    include: nodeInclude
  });
}

export async function deleteNode(nodeId: string) {
  return prisma.contentNode.delete({ where: { id: nodeId } });
}

// ── Team ──────────────────────────────────────────────────

export async function addNodeTeamMember(data: { nodeId: string; userId: string; role: string }) {
  return prisma.contentNodeTeamMember.upsert({
    where: {
      nodeId_userId_role: {
        nodeId: data.nodeId,
        userId: data.userId,
        role: data.role
      }
    },
    update: {},
    create: data,
    include: { user: userPreview }
  });
}

export async function getNodeTeamMemberById(teamMemberId: string) {
  return prisma.contentNodeTeamMember.findUnique({
    where: { id: teamMemberId }
  });
}

export async function removeNodeTeamMember(teamMemberId: string) {
  return prisma.contentNodeTeamMember.delete({ where: { id: teamMemberId } });
}

// ── Outputs ───────────────────────────────────────────────

export async function getMaxOutputVersion(nodeId: string): Promise<number | null> {
  const result = await prisma.contentNodeOutput.aggregate({
    where: { nodeId },
    _max: { version: true }
  });
  return result._max.version;
}

export async function createOutput(data: {
  nodeId: string;
  label: string;
  url: string;
  notes?: string;
  version: number;
  submittedByUserId?: string;
}) {
  return prisma.contentNodeOutput.create({
    data,
    include: {
      submittedBy: userPreview,
      reviewedBy: userPreview
    }
  });
}

export async function getOutputById(outputId: string) {
  return prisma.contentNodeOutput.findUnique({
    where: { id: outputId },
    include: {
      submittedBy: userPreview,
      reviewedBy: userPreview
    }
  });
}

export async function updateOutput(
  outputId: string,
  data: {
    label?: string;
    url?: string;
    notes?: string | null;
    approvalState?: string;
    reviewNote?: string | null;
    reviewedByUserId?: string | null;
    reviewedAt?: Date | null;
  }
) {
  return prisma.contentNodeOutput.update({
    where: { id: outputId },
    data,
    include: {
      submittedBy: userPreview,
      reviewedBy: userPreview
    }
  });
}

export async function demoteOtherApprovedOutputs(nodeId: string, exceptOutputId: string) {
  return prisma.contentNodeOutput.updateMany({
    where: {
      nodeId,
      id: { not: exceptOutputId },
      approvalState: "APPROVED"
    },
    data: {
      approvalState: "IN_REVIEW",
      reviewedAt: null,
      reviewedByUserId: null
    }
  });
}

export async function deleteOutput(outputId: string) {
  return prisma.contentNodeOutput.delete({ where: { id: outputId } });
}

export async function getLatestApprovedOutputForNode(nodeId: string) {
  return prisma.contentNodeOutput.findFirst({
    where: { nodeId, approvalState: "APPROVED" },
    orderBy: [{ version: "desc" }, { reviewedAt: "desc" }],
    include: {
      submittedBy: userPreview,
      reviewedBy: userPreview
    }
  });
}

// ── Resources ─────────────────────────────────────────────

export async function createResource(data: {
  nodeId: string;
  name: string;
  sourceType: string;
  cost?: Prisma.Decimal | number | string | null;
  quantity?: number;
  currency?: string | null;
  notes?: string;
  approvalState?: string;
  requestedByUserId?: string | null;
}) {
  return prisma.contentNodeResource.create({
    data,
    include: resourceInclude
  });
}

export async function getResourceById(resourceId: string) {
  return prisma.contentNodeResource.findUnique({
    where: { id: resourceId },
    include: resourceInclude
  });
}

export async function updateResource(
  resourceId: string,
  data: {
    name?: string;
    sourceType?: string;
    cost?: Prisma.Decimal | number | string | null;
    quantity?: number;
    currency?: string | null;
    notes?: string | null;
    approvalState?: string;
    reviewNote?: string | null;
    reviewedByUserId?: string | null;
    reviewedAt?: Date | null;
  }
) {
  return prisma.contentNodeResource.update({
    where: { id: resourceId },
    data,
    include: resourceInclude
  });
}

export async function deleteResource(resourceId: string) {
  return prisma.contentNodeResource.delete({ where: { id: resourceId } });
}

/**
 * Count rental resources on a node that have not yet been APPROVED.
 * Used to gate the "node -> COMPLETED" transition.
 */
export async function countPendingRentalResourcesForNode(nodeId: string): Promise<number> {
  return prisma.contentNodeResource.count({
    where: {
      nodeId,
      sourceType: "RENTAL",
      approvalState: { not: "APPROVED" }
    }
  });
}

// ── Permissions / ownership helpers ───────────────────────

export async function userHasPermission(roleId: string, permissionName: string): Promise<boolean> {
  const match = await prisma.rolePermission.findFirst({
    where: {
      roleId,
      permission: { name: permissionName }
    }
  });
  return !!match;
}

// ── Team / Project lookups (for Content linking) ──────────

export async function getTeamForContentLink(teamId: string) {
  return prisma.team.findUnique({
    where: { id: teamId },
    select: { id: true, name: true, verticalId: true, isActive: true }
  });
}

export async function getProjectForContentLink(projectId: string) {
  return prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true, verticalId: true, status: true }
  });
}

/**
 * Resolve the vertical owner ("head of Fiction" / "head of Non Fiction")
 * for a piece of content. Walks Content -> Project -> Vertical -> ownerUserId.
 *
 * Returns null when the vertical has no assigned owner yet (notifications
 * gracefully no-op in that case).
 */
export async function getVerticalOwnerForContent(contentId: string) {
  const content = await prisma.content.findUnique({
    where: { id: contentId },
    select: {
      id: true,
      title: true,
      project: {
        select: {
          id: true,
          name: true,
          vertical: {
            select: {
              id: true,
              name: true,
              slug: true,
              ownerUserId: true,
              owner: { select: { id: true, name: true, email: true, isActive: true } }
            }
          }
        }
      }
    }
  });
  if (!content) return null;
  return content;
}
