import { HttpError } from "../../utils/httpError";
import { indexWorkUnitForSearch } from "../ai/ai.service";
import { translateAudioWithSarvam } from "../ai/ai.sarvam";
import {
  computeDueFields,
  formatWorkUnitForResponse,
  resolveStatusAndClosedAt
} from "./work.due-fields";
import { extractWorkUnitsFromTranscript } from "./work.extraction";
import {
  createWorkUnit as createWorkUnitInDb,
  deleteWorkUnit as deleteWorkUnitInDb,
  findWorkStepsByUserAndDeadlineRange,
  findWorkUnitById,
  findWorkUnits,
  updateWorkUnit as updateWorkUnitInDb
} from "./work.repository";

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function parseOptionalDate(value?: string | null): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new HttpError(400, `Invalid date: ${value}`);
  }
  return parsed;
}

function canViewAll(roleName: string): boolean {
  return roleName === "admin" || roleName === "manager" || roleName === "superadmin";
}

export function assertCanView(
  unit: { userId: string; isPrivate: boolean },
  viewerUserId: string
): void {
  if (unit.isPrivate && unit.userId !== viewerUserId) {
    throw new HttpError(403, "Not authorized to view this work unit");
  }
}

export function assertCanModify(
  unit: { userId: string; isPrivate: boolean },
  viewerUserId: string,
  roleName: string
): void {
  if (unit.isPrivate) {
    if (unit.userId !== viewerUserId) {
      throw new HttpError(403, "Not authorized to modify this work unit");
    }
    return;
  }

  if (unit.userId !== viewerUserId && !canViewAll(roleName)) {
    throw new HttpError(403, "Not authorized to modify this work unit");
  }
}

function mapSteps(
  steps?: Array<{ description: string; deadline?: string | null; done?: boolean }>
) {
  return (steps ?? []).map((step) => ({
    description: step.description,
    deadline: parseOptionalDate(step.deadline) ?? null,
    done: step.done ?? false
  }));
}

function buildWorkUnitWriteFields(options: {
  existingStatus?: string;
  existingClosedAt?: Date | null;
  explicitStatus?: string;
  steps: Array<{ description: string; deadline: Date | null; done: boolean }>;
  stepsUpdated?: boolean;
}) {
  const { status, closedAt } = resolveStatusAndClosedAt({
    existingStatus: options.existingStatus ?? "OPEN",
    existingClosedAt: options.existingClosedAt ?? null,
    explicitStatus: options.explicitStatus,
    steps: options.steps,
    stepsUpdated: options.stepsUpdated ?? true
  });
  const dueFields = computeDueFields(options.steps);

  return {
    status,
    closedAt,
    nextDueAt: dueFields.nextDueAt,
    firstDueAt: dueFields.firstDueAt
  };
}

export async function createWorkUnit(
  userId: string,
  data: {
    title: string;
    context: string;
    status?: string;
    isPrivate?: boolean;
    steps?: Array<{ description: string; deadline?: string | null; done?: boolean }>;
  }
) {
  const steps = mapSteps(data.steps);
  const lifecycle = buildWorkUnitWriteFields({
    explicitStatus: data.status,
    steps
  });

  const unit = await createWorkUnitInDb({
    userId,
    title: data.title,
    context: data.context,
    isPrivate: data.isPrivate ?? false,
    ...lifecycle,
    steps
  });

  void indexWorkUnitForSearch(unit.id);
  return formatWorkUnitForResponse(unit);
}

export async function getWorkUnitById(id: string) {
  const unit = await findWorkUnitById(id);
  if (!unit) throw new HttpError(404, "Work unit not found");
  return formatWorkUnitForResponse(unit);
}

export async function listWorkUnits(options: {
  viewerUserId: string;
  viewerRole: string;
  userId?: string;
  status?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}) {
  const page = Math.max(1, Number(options.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(options.pageSize) || 20));

  const filterUserId = canViewAll(options.viewerRole) ? options.userId : undefined;

  const { items, total } = await findWorkUnits({
    userId: filterUserId,
    status: options.status,
    from: parseOptionalDate(options.from) ?? undefined,
    to: parseOptionalDate(options.to) ?? undefined,
    isPrivateVisibleForUserId: options.viewerUserId,
    page,
    pageSize
  });

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return {
    items: items.map((unit) => formatWorkUnitForResponse(unit)),
    pagination: { page, pageSize, total, totalPages, hasNextPage: page < totalPages }
  };
}

export async function updateWorkUnit(
  id: string,
  viewerUserId: string,
  roleName: string,
  data: {
    title?: string;
    context?: string;
    status?: string;
    isPrivate?: boolean;
    steps?: Array<{ description: string; deadline?: string | null; done?: boolean }>;
  }
) {
  const existingRaw = await findWorkUnitById(id);
  if (!existingRaw) throw new HttpError(404, "Work unit not found");
  assertCanModify(existingRaw, viewerUserId, roleName);

  const mappedSteps = data.steps !== undefined ? mapSteps(data.steps) : undefined;
  const lifecycle = buildWorkUnitWriteFields({
    existingStatus: existingRaw.status,
    existingClosedAt: existingRaw.closedAt,
    explicitStatus: data.status,
    steps: mappedSteps ?? existingRaw.steps,
    stepsUpdated: mappedSteps !== undefined
  });

  const unit = await updateWorkUnitInDb(id, {
    title: data.title,
    context: data.context,
    isPrivate: data.isPrivate,
    ...lifecycle,
    steps: mappedSteps
  });

  void indexWorkUnitForSearch(unit!.id);
  return formatWorkUnitForResponse(unit!);
}

export async function removeWorkUnit(id: string, viewerUserId: string, roleName: string) {
  const existing = await getWorkUnitById(id);
  assertCanModify(existing, viewerUserId, roleName);
  await deleteWorkUnitInDb(id);
}

export async function createWorkUnitsFromAudio(
  userId: string,
  fileBuffer: Buffer,
  originalname: string,
  mimetype: string
) {
  const { transcript } = await translateAudioWithSarvam({
    fileBuffer,
    originalname,
    mimetype
  });

  const extracted = await extractWorkUnitsFromTranscript(transcript);
  const workUnits = [];

  for (const unit of extracted) {
    const created = await createWorkUnit(userId, {
      title: unit.title,
      context: unit.context,
      status: unit.status,
      isPrivate: false,
      steps: unit.steps.map((step) => ({
        description: step.description,
        deadline: step.deadline
      }))
    });
    workUnits.push(created);
  }

  return { transcript, workUnits };
}

export async function getMyDeadlines(userId: string, date?: string) {
  const day = date ? new Date(date) : new Date();
  if (Number.isNaN(day.getTime())) {
    throw new HttpError(400, `Invalid date: ${date}`);
  }

  const from = startOfDay(day);
  const to = endOfDay(day);
  const steps = await findWorkStepsByUserAndDeadlineRange(userId, from, to);

  return {
    date: from,
    deadlines: steps.map((step) => ({
      id: step.id,
      description: step.description,
      deadline: step.deadline,
      done: step.done,
      workUnit: step.workUnit
    }))
  };
}
