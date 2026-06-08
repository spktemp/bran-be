import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import FormData from "form-data";
import https from "node:https";
import http from "node:http";
import { SarvamAIClient } from "sarvamai";

import { env } from "../../config/env";
import { HttpError } from "../../utils/httpError";

export type SarvamTranslateResult = {
  requestId: string | null;
  transcript: string;
  languageCode: string | null;
  languageProbability: number | null;
};

type SarvamSuccessResponse = {
  request_id: string | null;
  transcript: string;
  language_code: string | null;
  language_probability: number | null;
};

type SarvamErrorResponse = {
  error: {
    request_id: string | null;
    message: string;
    code: string;
  };
};

const SARVAM_ENDPOINT = "https://api.sarvam.ai/speech-to-text-translate";
const SARVAM_BATCH_POLL_INTERVAL_SECONDS = 3;
const SARVAM_BATCH_TIMEOUT_SECONDS = 600;

const SUPPORTED_MIME_TYPES = new Set([
  "audio/wav",
  "audio/x-wav",
  "audio/wave",
  "audio/mpeg",
  "audio/mp3",
  "audio/aac",
  "audio/aiff",
  "audio/ogg",
  "audio/opus",
  "audio/flac",
  "audio/x-flac",
  "audio/mp4",
  "audio/x-m4a",
  "audio/amr",
  "audio/webm",
  "video/webm",
  "video/mp4"
]);

export function isSupportedAudioMime(mimetype: string): boolean {
  return SUPPORTED_MIME_TYPES.has(mimetype.toLowerCase());
}

function extensionForMime(mimetype: string): string {
  const map: Record<string, string> = {
    "audio/wav": ".wav",
    "audio/x-wav": ".wav",
    "audio/wave": ".wav",
    "audio/mpeg": ".mp3",
    "audio/mp3": ".mp3",
    "audio/aac": ".aac",
    "audio/aiff": ".aiff",
    "audio/ogg": ".ogg",
    "audio/opus": ".ogg",
    "audio/flac": ".flac",
    "audio/x-flac": ".flac",
    "audio/mp4": ".m4a",
    "audio/x-m4a": ".m4a",
    "audio/amr": ".amr",
    "audio/webm": ".webm",
    "video/webm": ".webm",
    "video/mp4": ".mp4"
  };
  return map[mimetype.toLowerCase()] ?? ".wav";
}

function isAudioDurationLimitError(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("30 seconds") ||
    normalized.includes("maximum limit") ||
    normalized.includes("batch api for longer")
  );
}

function getSarvamClient(): SarvamAIClient {
  return new SarvamAIClient({ apiSubscriptionKey: env.sarvamApiKey });
}

function postFormData(
  url: string,
  form: FormData,
  headers: Record<string, string>
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const formHeaders = form.getHeaders();
    const allHeaders = { ...formHeaders, ...headers };

    const parsedUrl = new URL(url);
    const options: https.RequestOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || 443,
      path: parsedUrl.pathname,
      method: "POST",
      headers: allHeaders
    };

    const transport = parsedUrl.protocol === "https:" ? https : http;
    const req = transport.request(options, (res) => {
      let data = "";
      res.on("data", (chunk: Buffer) => {
        data += chunk.toString();
      });
      res.on("end", () => {
        resolve({ status: res.statusCode ?? 0, body: data });
      });
    });

    req.on("error", reject);

    form.pipe(req);
  });
}

function mapSarvamHttpError(status: number, message: string): never {
  if (status === 400) throw new HttpError(400, message);
  if (status === 403) throw new HttpError(403, "Sarvam API key is invalid or unauthorised");
  if (status === 422) throw new HttpError(422, message);
  if (status === 429) throw new HttpError(429, "Sarvam quota exceeded. Try again later.");
  throw new HttpError(502, `Sarvam API returned status ${status}: ${message}`);
}

async function uploadAudioToBatchJob(
  client: SarvamAIClient,
  jobId: string,
  fileName: string,
  fileBuffer: Buffer,
  mimetype: string
): Promise<void> {
  const uploadLinksResponse = await client.speechToTextTranslateJob.getUploadLinks({
    body: {
      job_id: jobId,
      files: [fileName]
    }
  });

  const uploadUrl = uploadLinksResponse.upload_urls[fileName]?.file_url;
  if (!uploadUrl) {
    throw new HttpError(502, "Sarvam batch upload URL was not returned");
  }

  const response = await fetch(uploadUrl, {
    method: "PUT",
    body: new Uint8Array(fileBuffer),
    headers: {
      "x-ms-blob-type": "BlockBlob",
      "Content-Type": mimetype
    }
  });

  if (response.status < 200 || response.status > 226) {
    throw new HttpError(502, `Sarvam batch upload failed with status ${response.status}`);
  }
}

async function translateAudioWithSarvamRest(params: {
  fileBuffer: Buffer;
  originalname: string;
  mimetype: string;
  prompt?: string;
}): Promise<SarvamTranslateResult> {
  const apiKey = env.sarvamApiKey;
  if (!apiKey) {
    throw new HttpError(503, "Sarvam API is not configured. Set SARVAM_API_KEY.");
  }

  if (!isSupportedAudioMime(params.mimetype)) {
    throw new HttpError(
      400,
      `Unsupported audio format: ${params.mimetype}. Supported: WAV, MP3, AAC, OGG, FLAC, MP4, WebM and others.`
    );
  }

  const form = new FormData();
  form.append("file", params.fileBuffer, {
    filename: params.originalname,
    contentType: params.mimetype
  });
  form.append("model", "saaras:v2.5");
  if (params.prompt) {
    form.append("prompt", params.prompt);
  }

  const { status, body } = await postFormData(SARVAM_ENDPOINT, form, {
    "api-subscription-key": apiKey
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new HttpError(502, "Invalid response from Sarvam API");
  }

  if (status === 200) {
    const ok = parsed as SarvamSuccessResponse;
    return {
      requestId: ok.request_id ?? null,
      transcript: ok.transcript,
      languageCode: ok.language_code ?? null,
      languageProbability: ok.language_probability ?? null
    };
  }

  const errBody = parsed as SarvamErrorResponse;
  const message = errBody?.error?.message ?? "Sarvam API error";
  mapSarvamHttpError(status, message);
}

async function translateAudioWithSarvamBatch(params: {
  fileBuffer: Buffer;
  originalname: string;
  mimetype: string;
  prompt?: string;
}): Promise<SarvamTranslateResult> {
  const apiKey = env.sarvamApiKey;
  if (!apiKey) {
    throw new HttpError(503, "Sarvam API is not configured. Set SARVAM_API_KEY.");
  }

  if (!isSupportedAudioMime(params.mimetype)) {
    throw new HttpError(
      400,
      `Unsupported audio format: ${params.mimetype}. Supported: WAV, MP3, AAC, OGG, FLAC, MP4, WebM and others.`
    );
  }

  const client = getSarvamClient();
  const fileName = `audio${extensionForMime(params.mimetype)}`;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sarvam-batch-"));

  try {
    const job = await client.speechToTextTranslateJob.createJob({
      model: "saaras:v2.5",
      prompt: params.prompt
    });

    await uploadAudioToBatchJob(client, job.jobId, fileName, params.fileBuffer, params.mimetype);
    await job.start();

    const status = await job.waitUntilComplete(
      SARVAM_BATCH_POLL_INTERVAL_SECONDS,
      SARVAM_BATCH_TIMEOUT_SECONDS
    );

    if (status.job_state.toLowerCase() === "failed") {
      throw new HttpError(502, status.error_message || "Sarvam batch transcription failed");
    }

    const fileResults = await job.getFileResults();
    if (fileResults.failed.length > 0) {
      const message = fileResults.failed[0]?.error_message ?? "Sarvam could not process audio";
      throw new HttpError(422, message);
    }
    if (fileResults.successful.length === 0) {
      throw new HttpError(502, "Sarvam batch job produced no transcription");
    }

    const outputDir = path.join(tmpDir, "output");
    await job.downloadOutputs(outputDir);

    const outputJsonPath = path.join(outputDir, `${fileName}.json`);
    if (!fs.existsSync(outputJsonPath)) {
      throw new HttpError(502, "Sarvam batch transcription output was not found");
    }

    const raw = JSON.parse(fs.readFileSync(outputJsonPath, "utf-8")) as SarvamSuccessResponse;
    if (!raw.transcript?.trim()) {
      throw new HttpError(422, "Sarvam could not extract a transcript from the audio");
    }

    return {
      requestId: raw.request_id ?? job.jobId,
      transcript: raw.transcript,
      languageCode: raw.language_code ?? null,
      languageProbability: raw.language_probability ?? null
    };
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }
    throw new HttpError(
      502,
      error instanceof Error ? error.message : "Sarvam batch transcription failed"
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

export async function translateAudioWithSarvam(params: {
  fileBuffer: Buffer;
  originalname: string;
  mimetype: string;
  prompt?: string;
}): Promise<SarvamTranslateResult> {
  try {
    return await translateAudioWithSarvamRest(params);
  } catch (error) {
    if (
      error instanceof HttpError &&
      (error.statusCode === 400 || error.statusCode === 422) &&
      isAudioDurationLimitError(error.message)
    ) {
      return translateAudioWithSarvamBatch(params);
    }
    throw error;
  }
}
