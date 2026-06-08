import { HttpError } from "../../utils/httpError";
import { indexAdhocWorkForSearch } from "../ai/ai.service";
import {
  createAdhocWork as createAdhocWorkInDb,
  deleteAdhocWork as deleteAdhocWorkInDb,
  findAdhocWorkById,
  findAdhocWorkEntries,
  updateAdhocWork as updateAdhocWorkInDb
} from "./adhoc-work.repository";

function parseOptionalDate(value?: string): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new HttpError(400, `Invalid date: ${value}`);
  }
  return parsed;
}

export async function createAdhocWork(
  userId: string,
  data: {
    description: string;
    output?: string;
    effortHours?: number;
  }
) {
  const entry = await createAdhocWorkInDb({
    userId,
    description: data.description,
    output: data.output,
    effortHours: data.effortHours
  });

  void indexAdhocWorkForSearch(entry.id);
  return entry;
}

export async function getAdhocWorkById(id: string) {
  const entry = await findAdhocWorkById(id);
  if (!entry) throw new HttpError(404, "Adhoc work entry not found");
  return entry;
}

export async function listAdhocWork(options: {
  userId?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}) {
  const page = Math.max(1, Number(options.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(options.pageSize) || 20));

  const { items, total } = await findAdhocWorkEntries({
    userId: options.userId,
    from: parseOptionalDate(options.from),
    to: parseOptionalDate(options.to),
    page,
    pageSize
  });

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return {
    items,
    pagination: { page, pageSize, total, totalPages, hasNextPage: page < totalPages }
  };
}

export async function updateAdhocWork(
  id: string,
  data: {
    description?: string;
    output?: string | null;
    effortHours?: number | null;
  }
) {
  await getAdhocWorkById(id);
  const entry = await updateAdhocWorkInDb(id, data);
  void indexAdhocWorkForSearch(entry.id);
  return entry;
}

export async function removeAdhocWork(id: string) {
  await getAdhocWorkById(id);
  await deleteAdhocWorkInDb(id);
}
