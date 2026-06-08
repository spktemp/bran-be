import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { z } from "zod";

import { env } from "../../config/env";
import { HttpError } from "../../utils/httpError";
import { WORK_STATUSES } from "./work.constants";

export type ExtractedStep = { description: string; deadline: string | null };
export type ExtractedWorkUnit = {
  title: string;
  context: string;
  status: "OPEN" | "CLOSED";
  steps: ExtractedStep[];
};

let anthropicClient: Anthropic | null = null;
let geminiClient: GoogleGenerativeAI | null = null;

function getAnthropic(): Anthropic {
  if (!anthropicClient) {
    if (!env.anthropicApiKey) {
      throw new Error("ANTHROPIC_API_KEY is not configured");
    }
    anthropicClient = new Anthropic({ apiKey: env.anthropicApiKey });
  }
  return anthropicClient;
}

function getGemini(): GoogleGenerativeAI {
  if (!geminiClient) {
    if (!env.geminiApiKey) {
      throw new Error("GEMINI_API_KEY is not configured");
    }
    geminiClient = new GoogleGenerativeAI(env.geminiApiKey);
  }
  return geminiClient;
}

function getAiProvider(): "anthropic" | "gemini" {
  return env.aiProvider.toLowerCase() === "gemini" ? "gemini" : "anthropic";
}

const extractedResponseSchema = z.object({
  workUnits: z.array(
    z.object({
      title: z.string().trim().min(1),
      context: z.string().trim().min(1),
      status: z.enum(WORK_STATUSES).optional(),
      steps: z
        .array(
          z.object({
            description: z.string().trim().min(1),
            deadline: z.string().nullable().optional()
          })
        )
        .optional()
    })
  )
});

function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

export function parseDeadlineToIso(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return `${trimmed}T00:00:00.000Z`;
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

async function callLlm(systemPrompt: string, userPrompt: string): Promise<string> {
  const provider = getAiProvider();

  if (provider === "gemini") {
    const model = getGemini().getGenerativeModel({
      model: env.geminiModel,
      systemInstruction: systemPrompt,
      generationConfig: { maxOutputTokens: 2048, temperature: 0.2 }
    });
    const result = await model.generateContent(userPrompt);
    return result.response.text() || "";
  }

  const response = await getAnthropic().messages.create({
    model: env.anthropicModel,
    max_tokens: 2048,
    temperature: 0.2,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }]
  });

  const textBlock = response.content.find((block) => block.type === "text");
  return textBlock?.text ?? "";
}

export async function extractWorkUnitsFromTranscript(
  transcript: string,
  now: Date = new Date()
): Promise<ExtractedWorkUnit[]> {
  const systemPrompt =
    "You extract structured work units from spoken meeting notes or voice memos. " +
    "Return STRICT JSON only (no markdown, no prose) with shape: " +
    '{ "workUnits": [ { "title": string, "context": string, "status": "OPEN"|"CLOSED", "steps": [ { "description": string, "deadline": string|null } ] } ] }. ' +
    "Rules: one transcript may contain MULTIPLE work units; status must be OPEN unless clearly finished; " +
    "deadline must be ISO-8601 resolved relative to the provided current date-time: use full datetime (YYYY-MM-DDTHH:mm:ss.sssZ) when a time is mentioned, otherwise date-only (YYYY-MM-DD), or null if none mentioned; " +
    "the first step should capture the action already taken or meeting held when relevant, and follow-up actions become subsequent steps.";

  const userPrompt = `Current date-time: ${now.toISOString()}\n\nTranscript:\n"""${transcript}"""`;

  const raw = await callLlm(systemPrompt, userPrompt);

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFences(raw));
  } catch {
    throw new HttpError(502, "Could not extract work units from audio");
  }

  const validated = extractedResponseSchema.safeParse(parsed);
  if (!validated.success) {
    throw new HttpError(502, "Could not extract work units from audio");
  }

  return validated.data.workUnits.map((unit) => ({
    title: unit.title,
    context: unit.context,
    status: unit.status ?? "OPEN",
    steps: (unit.steps ?? [])
      .filter((step) => step.description.trim().length > 0)
      .map((step) => ({
        description: step.description.trim(),
        deadline: parseDeadlineToIso(step.deadline ?? null)
      }))
  }));
}
