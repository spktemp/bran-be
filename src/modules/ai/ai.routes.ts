import { Router } from "express";
import multer from "multer";
import { z } from "zod";

import { HttpError } from "../../utils/httpError";
import { param } from "../../utils/param";
import { authenticate } from "../auth/auth.middleware";
import { requirePermission } from "../auth/auth.guard";
import { getMyAiQuery, listMyAiQueries, processAiQuery } from "./ai.service";
import { isSupportedAudioMime, translateAudioWithSarvam } from "./ai.sarvam";

const aiRouter = Router();

aiRouter.use(authenticate);
aiRouter.use(requirePermission("query_ai"));

const querySchema = z.object({
  query: z.string().min(1, "Query is required").max(1000)
});

aiRouter.post("/query", async (req, res, next) => {
  try {
    const { query } = querySchema.parse(req.body);
    const result = await processAiQuery(query, req.user!.userId);
    res.status(200).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

const historyQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional()
});

// Per-user, scoped query history.
aiRouter.get("/queries", async (req, res, next) => {
  try {
    const { page, pageSize } = historyQuerySchema.parse(req.query);
    const result = await listMyAiQueries({ userId: req.user!.userId, page, pageSize });
    res.status(200).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

aiRouter.get("/queries/:id", async (req, res, next) => {
  try {
    const entry = await getMyAiQuery(param(req.params.id), req.user!.userId);
    res.status(200).json({ success: true, data: entry });
  } catch (error) {
    next(error);
  }
});

// 25 MB limit — Sarvam recommends audio under 30 seconds; 25 MB covers most quality settings
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

const audioTranslateBodySchema = z.object({
  prompt: z.string().max(500).optional()
});

aiRouter.post(
  "/audio-translate",
  audioUpload.single("file"),
  async (req, res, next) => {
    try {
      if (!req.file) {
        throw new HttpError(400, 'Audio file is required. Send it as form-data field "file".');
      }

      const body = audioTranslateBodySchema.safeParse(req.body);
      const prompt = body.success ? body.data.prompt : undefined;

      const result = await translateAudioWithSarvam({
        fileBuffer: req.file.buffer,
        originalname: req.file.originalname,
        mimetype: req.file.mimetype,
        prompt
      });

      res.status(200).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
);

export { aiRouter };
