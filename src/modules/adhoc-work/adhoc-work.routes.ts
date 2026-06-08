import { Router } from "express";

import { param } from "../../utils/param";
import { requirePermission } from "../auth/auth.guard";
import { authenticate } from "../auth/auth.middleware";
import {
  createAdhocWorkSchema,
  listAdhocWorkQuerySchema,
  updateAdhocWorkSchema
} from "./adhoc-work.schemas";
import {
  createAdhocWork,
  getAdhocWorkById,
  listAdhocWork,
  removeAdhocWork,
  updateAdhocWork
} from "./adhoc-work.service";

const adhocWorkRouter = Router();

adhocWorkRouter.use(authenticate);

function canViewAll(roleName: string): boolean {
  return roleName === "admin" || roleName === "manager" || roleName === "superadmin";
}

adhocWorkRouter.post("/", requirePermission("create_tasks"), async (req, res, next) => {
  try {
    const payload = createAdhocWorkSchema.parse(req.body);
    const entry = await createAdhocWork(req.user!.userId, payload);
    res.status(201).json({ success: true, data: entry });
  } catch (error) {
    next(error);
  }
});

adhocWorkRouter.get("/", async (req, res, next) => {
  try {
    const query = listAdhocWorkQuerySchema.parse(req.query);
    const viewAll = canViewAll(req.user!.roleName);
    const userId = viewAll ? query.userId : req.user!.userId;

    const result = await listAdhocWork({
      userId,
      from: query.from,
      to: query.to,
      page: query.page,
      pageSize: query.pageSize
    });

    res.status(200).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

adhocWorkRouter.get("/:id", async (req, res, next) => {
  try {
    const entry = await getAdhocWorkById(param(req.params.id));
    if (!canViewAll(req.user!.roleName) && entry.userId !== req.user!.userId) {
      res.status(403).json({ success: false, error: "Not authorized to view this entry" });
      return;
    }
    res.status(200).json({ success: true, data: entry });
  } catch (error) {
    next(error);
  }
});

adhocWorkRouter.put("/:id", async (req, res, next) => {
  try {
    const id = param(req.params.id);
    const existing = await getAdhocWorkById(id);
    if (!canViewAll(req.user!.roleName) && existing.userId !== req.user!.userId) {
      res.status(403).json({ success: false, error: "Not authorized to update this entry" });
      return;
    }

    const payload = updateAdhocWorkSchema.parse(req.body);
    const entry = await updateAdhocWork(id, payload);
    res.status(200).json({ success: true, data: entry });
  } catch (error) {
    next(error);
  }
});

adhocWorkRouter.delete("/:id", async (req, res, next) => {
  try {
    const id = param(req.params.id);
    const existing = await getAdhocWorkById(id);
    if (!canViewAll(req.user!.roleName) && existing.userId !== req.user!.userId) {
      res.status(403).json({ success: false, error: "Not authorized to delete this entry" });
      return;
    }

    await removeAdhocWork(id);
    res.status(200).json({ success: true, message: "Adhoc work entry deleted" });
  } catch (error) {
    next(error);
  }
});

export { adhocWorkRouter };
