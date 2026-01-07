import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { z } from "zod";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const MAX_INPUT_CHARS = Number(process.env.MAX_INPUT_CHARS ?? 100_000);

const transformRequestSchema = z.object({
  text: z.string().min(1).max(MAX_INPUT_CHARS),
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

export async function POST(request: NextRequest) {
  let text: string;
  try {
    const body = await request.json();
    ({ text } = transformRequestSchema.parse(body));
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

  try {
    const systemPrompt = `You are a professional document transformer. Your task is to take messy, unstructured text and transform it into a clean, well-organized, usable document.

CRITICAL RULES:
- ONLY use information that is explicitly present in the input text
- DO NOT invent, infer, or make up any content that is not in the input
- DO NOT add examples, generic content, or placeholder information
- If the input text is unclear, garbled, or doesn't contain meaningful information, be honest about it
- If the input appears to be OCR errors or random characters, indicate that the text extraction may have failed
- Only create sections, bullets, and actions based on actual content from the input

Transform the input text into a structured format with:
1. A clear, descriptive title based ONLY on what's in the input
2. A concise summary (2-3 sentences) that accurately reflects the input content
3. Multiple sections with headings and bullet points that organize ONLY the information present in the input
4. A "Next Actions" section ONLY if there are actual actionable items mentioned in the input

If the input text is too unclear, garbled, or doesn't contain meaningful information, return a document that reflects this honestly rather than making up content.

Return ONLY valid JSON matching this exact schema:
{
  "title": string,
  "summary": string,
  "sections": [{"heading": string, "bullets": string[]}],
  "next_actions": [{"action": string, "first_step": string}]
}`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: text },
      ],
      response_format: { type: "json_object" },
      temperature: 0.1,
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) {
      throw new Error("No response from OpenAI");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      return NextResponse.json(
        { error: "Model returned an invalid response format. Please try again." },
        { status: 502 }
      );
    }

    const validated = transformResponseSchema.parse(parsed);

    return NextResponse.json(validated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Model returned an unexpected response shape. Please try again." },
        { status: 502 }
      );
    }
    if (error instanceof Error) {
      return NextResponse.json(
        { error: "Failed to transform text. Please try again." },
        { status: 500 }
      );
    }
    return NextResponse.json(
      { error: "An unexpected error occurred" },
      { status: 500 }
    );
  }
}
