import { Router } from "express";
import multer from "multer";

import { HttpError } from "../../utils/httpError";
import { param } from "../../utils/param";
import { isSupportedAudioMime } from "../ai/ai.sarvam";
import { requirePermission } from "../auth/auth.guard";
import { authenticate } from "../auth/auth.middleware";
import {
  createWorkUnitSchema,
  deadlinesQuerySchema,
  listWorkUnitsQuerySchema,
  updateWorkUnitSchema
} from "./work.schemas";
import {
  assertCanView,
  createWorkUnit,
  createWorkUnitsFromAudio,
  getMyDeadlines,
  getWorkUnitById,
  listWorkUnits,
  removeWorkUnit,
  updateWorkUnit
} from "./work.service";

const workRouter = Router();

workRouter.use(authenticate);

const MAX_AUDIO_SIZE_BYTES = 25 * 1024 * 1024;

const audioUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_AUDIO_SIZE_BYTES },
  fileFilter: (_req, file, cb) => {
    if (isSupportedAudioMime(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new HttpError(400, `Unsupported audio format: ${file.mimetype}`));
    }
  }
});

function canViewAll(roleName: string): boolean {
  return roleName === "admin" || roleName === "manager" || roleName === "superadmin";
}

workRouter.post(
  "/audio",
  requirePermission("create_tasks"),
  audioUpload.single("file"),
  async (req, res, next) => {
    try {
      if (!req.file) {
        throw new HttpError(400, 'Audio file is required. Send it as form-data field "file".');
      }

      const result = await createWorkUnitsFromAudio(
        req.user!.userId,
        req.file.buffer,
        req.file.originalname,
        req.file.mimetype
      );
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
);

workRouter.post("/", requirePermission("create_tasks"), async (req, res, next) => {
  try {
    const payload = createWorkUnitSchema.parse(req.body);
    const unit = await createWorkUnit(req.user!.userId, payload);
    res.status(201).json({ success: true, data: unit });
  } catch (error) {
    next(error);
  }
});

workRouter.get("/deadlines", async (req, res, next) => {
  try {
    const query = deadlinesQuerySchema.parse(req.query);
    const result = await getMyDeadlines(req.user!.userId, query.date);
    res.status(200).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

workRouter.get("/", async (req, res, next) => {
  try {
    const query = listWorkUnitsQuerySchema.parse(req.query);
    const viewAll = canViewAll(req.user!.roleName);
    const filterUserId = viewAll ? query.userId : undefined;

    const result = await listWorkUnits({
      viewerUserId: req.user!.userId,
      viewerRole: req.user!.roleName,
      userId: filterUserId,
      status: query.status,
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

workRouter.get("/:id", async (req, res, next) => {
  try {
    const unit = await getWorkUnitById(param(req.params.id));
    assertCanView(unit, req.user!.userId);
    res.status(200).json({ success: true, data: unit });
  } catch (error) {
    next(error);
  }
});

workRouter.put("/:id", async (req, res, next) => {
  try {
    const id = param(req.params.id);
    const payload = updateWorkUnitSchema.parse(req.body);
    const unit = await updateWorkUnit(id, req.user!.userId, req.user!.roleName, payload);
    res.status(200).json({ success: true, data: unit });
  } catch (error) {
    next(error);
  }
});

workRouter.delete("/:id", async (req, res, next) => {
  try {
    const id = param(req.params.id);
    await removeWorkUnit(id, req.user!.userId, req.user!.roleName);
    res.status(200).json({ success: true, message: "Work unit deleted" });
  } catch (error) {
    next(error);
  }
});

export { workRouter };
