import { NextRequest, NextResponse } from "next/server";
import OpenAI, { toFile } from "openai";
import { z } from "zod";

function getOpenAIClient() {
  // Instantiate lazily so builds don't require OPENAI_API_KEY.
  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });
}

const MAX_INPUT_CHARS = Number(process.env.MAX_INPUT_CHARS ?? 100_000);
const MAX_FILE_BYTES = Number(process.env.MAX_FILE_BYTES ?? 10 * 1024 * 1024);

const OPENAI_TEXT_MODEL = process.env.OPENAI_TEXT_MODEL ?? "gpt-4o";
// `input_file` support varies by model; default to a smaller, more compatible model.
const OPENAI_FILE_MODEL = process.env.OPENAI_FILE_MODEL ?? "gpt-4o-mini";

const transformRequestSchema = z.object({
  text: z.string().min(1).max(MAX_INPUT_CHARS),
  notes: z.string().max(10_000).optional(),
});

const transformFileNotesSchema = z.object({
  notes: z.string().max(10_000).optional(),
});

const transformResponseSchema = z.object({
  title: z.string(),
  summary: z.string(),
  sections: z.array(
    z.object({
      heading: z.string(),
      bullets: z.array(z.string()),
    })
  ),
  next_actions: z.array(
    z.object({
      action: z.string(),
      first_step: z.string(),
    })
  ),
});

function shouldApplyNotesRewritePass(notes?: string) {
  return Boolean(notes && notes.trim().length > 0);
}

function getSystemPrompt() {
  return `You are a professional document + data analyst. Your task is to take messy text OR tabular data (like CSV previews) and transform it into a clean, well-organized, usable summary WITH analysis that is supported by the input.

CRITICAL RULES:
- ONLY use information that is explicitly present in the input text
- DO NOT invent facts that are not supported by the input
- You MAY compute/derive conclusions from the input (e.g., totals, averages, rankings, league tables) as long as they are strictly based on values present in the input
- DO NOT add examples, generic content, or placeholder information
- If the input text is unclear, garbled, or doesn't contain meaningful information, be honest about it
- If the input appears to be OCR errors or random characters, indicate that the text extraction may have failed
- If the input is a truncated preview (e.g., it says "preview", "truncated", or similar), clearly label any results as based on the provided subset

USER NOTES / INSTRUCTIONS (if provided by the user):
- Treat them as REQUIRED output constraints (tone, format, structure, what to emphasize/ignore, etc.)
- They are NOT source facts; do not treat them as information about the document
- Follow them as long as they don't conflict with the CRITICAL RULES above and the required JSON schema below
- If the user asks for a different writing style (e.g., "as a poem"), comply by expressing the content in that style INSIDE the JSON fields (e.g., poem-like lines in summary and/or bullet points)

If the input appears to be tabular (columns/rows, separators like "|" or ","), do the following BEFORE writing the final output:
- Identify the likely schema: list the columns you see and what they appear to represent
- Normalize obvious variants (e.g., "Home Team" vs "HomeTeam") conceptually when reasoning
- Compute the most useful derived insights that the available columns allow
- If a requested/typical insight is NOT possible from the columns provided, say what's missing instead of guessing

For sports match data (e.g., football/soccer) when columns allow it (team names + scores and/or match results):
- Derive standings/table (points, W/D/L, GF/GA, GD) and identify who would finish top
- Identify highest scoring teams, most goals for/against, biggest win, highest scoring match, home vs away splits if possible
- If player goal data exists (player name + goals), identify top scorers/assist leaders as applicable

Transform the input into a structured format with:
1. A clear, descriptive title based ONLY on what's in the input
2. A concise summary (typically 2-3 sentences, unless the user's instructions require a different style/structure) that accurately reflects the input content and highlights key takeaways
3. Multiple sections with headings and bullet points that include both organization AND computed insights (when possible)
4. "Next Actions" ONLY if there are actual actionable items mentioned in the input; otherwise return an empty array

If the input text is too unclear, garbled, or doesn't contain meaningful information, return a document that reflects this honestly rather than making up content.

Return ONLY valid JSON matching this exact schema:
{
  "title": string,
  "summary": string,
  "sections": [{"heading": string, "bullets": string[]}],
  "next_actions": [{"action": string, "first_step": string}]
}`;
}

function buildFileUserPrompt(notes?: string) {
  const notesPart =
    notes && notes.trim().length > 0
      ? `\n\nAdditional user notes / instructions (treat as instructions, NOT as source facts):\n${notes.trim()}\n`
      : "";
  // Important: OpenAI JSON mode requires that the prompt/input text includes the word "JSON".
  return `Analyze the attached file and produce the requested structured output as valid JSON.${notesPart}`;
}

function buildTextUserPrompt(text: string, notes?: string) {
  const notesPart =
    notes && notes.trim().length > 0
      ? `\n\nAdditional user notes / instructions (treat as instructions, NOT as source facts):\n${notes.trim()}\n`
      : "";
  // Important: OpenAI JSON mode requires that the prompt/input text includes the word "JSON".
  return `Transform the following input into the required response as valid JSON.${notesPart}\n\nINPUT (source facts):\n${text}`;
}

function buildNotesRewritePrompt(originalJson: string, notes?: string) {
  const notesPart =
    notes && notes.trim().length > 0
      ? `\n\nUser notes / instructions (REQUIRED constraints):\n${notes.trim()}\n`
      : "";

  // Important: OpenAI JSON mode requires that the prompt includes the word "JSON".
  return `Rewrite the following JSON output so it complies with the user's notes/instructions while preserving facts.

CRITICAL:
- Do NOT add facts that are not already present in the JSON below
- Do NOT remove facts that are already present; you may rephrase them
- Keep EXACTLY the same JSON schema/keys as before (title, summary, sections[{heading,bullets}], next_actions[{action,first_step}])
- You MAY change tone, ordering, emphasis, verbosity, and phrasing to match the notes
- It is OK to use line breaks (\\n) inside strings if the notes request it (e.g., poetry)
- If the user's instructions conflict with the schema, comply by expressing the intent INSIDE the strings while keeping the schema

Return ONLY valid JSON.
${notesPart}

JSON to rewrite (source facts):
${originalJson}`;
}

function normalizeOpenAIError(error: unknown): { status: number; message: string } {
  const fallback = { status: 500, message: "Failed to analyze input. Please try again." };
  if (!error || typeof error !== "object") return fallback;

  const err = error as {
    status?: unknown;
    message?: unknown;
    error?: { message?: unknown; type?: unknown; code?: unknown } | unknown;
  };

  const status = typeof err.status === "number" ? err.status : 500;
  const nestedMessage =
    err.error && typeof err.error === "object" && err.error !== null
      ? (err.error as { message?: unknown }).message
      : undefined;

  const message =
    (typeof nestedMessage === "string" && nestedMessage.trim()) ||
    (typeof err.message === "string" && err.message.trim()) ||
    fallback.message;

  return { status, message };
}

export async function POST(request: NextRequest) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: "Server is missing OPENAI_API_KEY configuration." },
        { status: 500 }
      );
    }

    const openai = getOpenAIClient();
    const contentType = request.headers.get("content-type") ?? "";
    const systemPrompt = getSystemPrompt();

    let rawModelText: string | null = null;
    let notesForRequest: string | undefined;

    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("file");
      const notesValue = form.get("notes");
      const notes =
        typeof notesValue === "string"
          ? transformFileNotesSchema.parse({ notes: notesValue }).notes
          : undefined;
      notesForRequest = notes;

      if (!(file instanceof File)) {
        return NextResponse.json(
          { error: "Missing file upload (expected form field 'file')." },
          { status: 400 }
        );
      }

      if (file.size > MAX_FILE_BYTES) {
        return NextResponse.json(
          {
            error: `File is too large. Maximum is ${MAX_FILE_BYTES.toLocaleString()} bytes.`,
          },
          { status: 413 }
        );
      }

      const uploaded = await openai.files.create({
        file: await toFile(Buffer.from(await file.arrayBuffer()), file.name, {
          type: file.type || undefined,
        }),
        // Most broadly compatible purpose for using files with models/tools.
        purpose: "assistants",
      });

      const isImage = (file.type || "").startsWith("image/");
      const fileContent = isImage
        ? ({
            type: "input_image",
            detail: "auto",
            file_id: uploaded.id,
          } as const)
        : ({
            type: "input_file",
            file_id: uploaded.id,
          } as const);

      const response = await openai.responses.create({
        model: OPENAI_FILE_MODEL,
        instructions: systemPrompt,
        input: [
          {
            role: "user",
            content: [
              { type: "input_text", text: buildFileUserPrompt(notes) },
              fileContent,
            ],
          },
        ],
        text: { format: { type: "json_object" } },
        temperature: 0.1,
      });

      rawModelText = response.output_text ?? null;
    } else {
      let text: string;
      let notes: string | undefined;
      try {
        const body = await request.json();
        ({ text, notes } = transformRequestSchema.parse(body));
      } catch (error) {
        if (error instanceof z.ZodError) {
          const tooBig = error.issues.some((issue) => issue.code === "too_big");
          return NextResponse.json(
            {
              error: tooBig
                ? `Input text is too large. Maximum is ${MAX_INPUT_CHARS.toLocaleString()} characters.`
                : "Invalid request format",
            },
            { status: tooBig ? 413 : 400 }
          );
        }

        return NextResponse.json(
          { error: "Invalid request body" },
          { status: 400 }
        );
      }
      notesForRequest = notes;

      const response = await openai.responses.create({
        model: OPENAI_TEXT_MODEL,
        instructions: systemPrompt,
        input: [
          {
            role: "user",
            content: [{ type: "input_text", text: buildTextUserPrompt(text, notes) }],
          },
        ],
        text: { format: { type: "json_object" } },
        temperature: 0.1,
      });

      rawModelText = response.output_text ?? null;
    }

    if (!rawModelText) {
      throw new Error("No response from OpenAI");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawModelText);
    } catch {
      return NextResponse.json(
        { error: "Model returned an invalid response format. Please try again." },
        { status: 502 }
      );
    }

    let validated = transformResponseSchema.parse(parsed);

    // If the user provided notes/instructions, do a second "rewrite" pass over the structured
    // JSON to enforce those constraints while preserving facts and schema.
    if (shouldApplyNotesRewritePass(notesForRequest)) {
      const rewrite = await openai.responses.create({
        model: OPENAI_TEXT_MODEL,
        instructions:
          "You are a careful editor. You rewrite content for style ONLY, preserving facts and schema.",
        input: [
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: buildNotesRewritePrompt(JSON.stringify(validated), notesForRequest),
              },
            ],
          },
        ],
        text: { format: { type: "json_object" } },
        temperature: 0.4,
      });

      const rewrittenText = rewrite.output_text ?? null;
      if (rewrittenText) {
        try {
          const rewrittenParsed = JSON.parse(rewrittenText);
          validated = transformResponseSchema.parse(rewrittenParsed);
        } catch {
          // If rewrite fails, fall back to the original validated output.
        }
      }
    }

    // The model occasionally returns placeholder/blank "next_actions" items.
    // Filter those out so the UI can reliably hide the section when empty.
    const sanitized = {
      ...validated,
      next_actions: validated.next_actions.filter(
        (a) => a.action.trim().length > 0 && a.first_step.trim().length > 0
      ),
    };

    return NextResponse.json(sanitized, {
      headers: {
        "x-received-notes-length": String((notesForRequest ?? "").length),
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Model returned an unexpected response shape. Please try again." },
        { status: 502 }
      );
    }
    const normalized = normalizeOpenAIError(error);
    return NextResponse.json({ error: normalized.message }, { status: normalized.status });
  }
}
