"use client"

import { useRef, useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Card } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Copy, Printer, FileText, Sparkles, Check, Upload, Coffee } from "lucide-react"
import { cn } from "@/lib/utils"
import { z } from "zod"
import Papa from "papaparse"

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
})

type TransformResponse = z.infer<typeof transformResponseSchema>

const getMeaningfulNextActions = (output: TransformResponse) =>
  output.next_actions.filter(
    (a) => a.action.trim().length > 0 && a.first_step.trim().length > 0
  )

function TransformLogo({ className }: { className?: string }) {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 28 28"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <g opacity="0.4">
        <circle cx="6" cy="7" r="1.5" fill="currentColor" />
        <circle cx="6" cy="14" r="1.5" fill="currentColor" />
        <circle cx="6" cy="21" r="1.5" fill="currentColor" />
      </g>
      <path d="M11 7L13 7M11 14L13 14M11 21L13 21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M16 7L24 7M16 14L24 14M16 21L24 21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="14" cy="14" r="2" fill="currentColor" opacity="0.3" />
    </svg>
  )
}

const sampleText = `hey team just wanted to recap our meeting today - so basically we decided to launch on march 15 which is pretty tight but doable, budget wise we got the 250k approved which is awesome!!! sarah you're doing frontend mike backend and lisa design/ux stuff. we need to finalize design system by feb 1 and we'll do weekly checkins monday 2pm. action items: schedule design review, setup repo and ci/cd, write tech spec, and confirm vendor stuff by friday!`

// Must stay in sync with server-side MAX_INPUT_CHARS (see `app/api/transform/route.ts`)
const MAX_TEXT_CHARS = 100_000

async function extractTextFromPdf(file: File): Promise<string> {
  const pdfjs = await import("pdfjs-dist")
  // Use the worker shipped in `/public` (matches our pdfjs-dist version).
  ;(pdfjs as unknown as { GlobalWorkerOptions: { workerSrc: string } }).GlobalWorkerOptions.workerSrc =
    "/pdf.worker.min.mjs"

  const data = new Uint8Array(await file.arrayBuffer())
  const loadingTask = (pdfjs as unknown as { getDocument: (init: unknown) => any }).getDocument({
    data,
  })
  const pdf = await loadingTask.promise

  const pages: string[] = []
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()
    const pageText = (content.items as Array<{ str?: string }>)
      .map((it) => it.str ?? "")
      .join(" ")
      .replace(/\s+/g, " ")
      .trim()
    if (pageText) pages.push(pageText)
  }

  return pages.join("\n\n").trim()
}

async function extractTextFromCsv(file: File): Promise<string> {
  const raw = await file.text()
  const parsed = Papa.parse<string[]>(raw, { skipEmptyLines: true })
  const rows = (parsed.data ?? []).slice(0, 50)
  const rendered = rows.map((row) => (row ?? []).map((cell) => String(cell ?? "")).join(" | ")).join("\n")
  return `CSV preview (first ${rows.length} row${rows.length === 1 ? "" : "s"})\n\n${rendered}`.trim()
}

async function extractTextFromImage(file: File): Promise<string> {
  const { createWorker } = await import("tesseract.js")
  const worker = await createWorker("eng", 1, {
    workerPath: "https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/worker.min.js",
    corePath: "https://cdn.jsdelivr.net/npm/tesseract.js-core@7.0.0",
  })
  const ret = await worker.recognize(file)
  await worker.terminate()
  return (ret?.data?.text ?? "").trim()
}

export default function MakeThisUsablePage() {
  const [inputText, setInputText] = useState("")
  const [isProcessing, setIsProcessing] = useState(false)
  const [isExtracting, setIsExtracting] = useState(false)
  const [hasOutput, setHasOutput] = useState(false)
  const [copied, setCopied] = useState(false)
  const [checkedActions, setCheckedActions] = useState<Record<number, boolean>>({})
  const [output, setOutput] = useState<TransformResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const handleMakeUsable = async () => {
    if (!selectedFile && !inputText.trim()) return

    if (!selectedFile && inputText.length > MAX_TEXT_CHARS) {
      setError(
        `This input is too long (${inputText.length.toLocaleString()} chars). Maximum is ${MAX_TEXT_CHARS.toLocaleString()} chars. Try shortening the text or uploading a file instead.`
      )
      return
    }

    setIsProcessing(true)
    setHasOutput(false)
    setError(null)
    setCheckedActions({})
    setOutput(null)

    try {
      const response =
        inputText.trim().length > 0
          ? await fetch("/api/transform", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ text: inputText }),
            })
          : await fetch("/api/transform", {
              method: "POST",
              body: (() => {
                const form = new FormData()
                if (selectedFile) form.append("file", selectedFile)
                return form
              })(),
            })

      if (!response.ok) {
        let message = `Request failed (${response.status})`
        try {
          const data = await response.json()
          message = data?.error || message
        } catch {
          try {
            const text = await response.text()
            if (text) message = text
          } catch {
            // ignore
          }
        }
        throw new Error(message)
      }

      const data = await response.json()
      const validated = transformResponseSchema.parse(data)
      setOutput(validated)
      setHasOutput(true)
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "An unexpected error occurred. Please try again."
      )
    } finally {
      setIsProcessing(false)
    }
  }

  const handleUseSample = () => {
    setInputText(sampleText)
    setHasOutput(false)
    setSelectedFile(null)
    setUploadedFileName(null)
  }

  // File size limit (in bytes) - same for all file types
  const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return bytes + " B"
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB"
    return (bytes / (1024 * 1024)).toFixed(1) + " MB"
  }

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    // Check file size
    const maxSize = MAX_FILE_SIZE
    if (file.size > maxSize) {
      const errorMessage = `File is too large. Maximum size: ${formatFileSize(maxSize)}. Your file: ${formatFileSize(file.size)}.`
      setError(errorMessage)
      event.target.value = ""
      return
    }

    setError(null)
    setSelectedFile(file)
    setUploadedFileName(file.name)
    setHasOutput(false)
    setIsExtracting(true)
    // Reset file input so selecting same file again triggers onChange
    event.target.value = ""

    try {
      const name = file.name.toLowerCase()
      let extracted = ""

      if (file.type === "application/pdf" || name.endsWith(".pdf")) {
        extracted = await extractTextFromPdf(file)
      } else if (file.type === "text/csv" || name.endsWith(".csv")) {
        extracted = await extractTextFromCsv(file)
      } else if ((file.type || "").startsWith("image/")) {
        extracted = await extractTextFromImage(file)
      } else {
        // Best-effort fallback for other text-like files.
        extracted = await file.text()
      }

      if (!extracted.trim()) {
        setError(
          "Couldn’t extract any readable text from that file. If it’s a scanned PDF/image, try a clearer scan or upload the image directly for OCR."
        )
        return
      }

      if (extracted.length > MAX_TEXT_CHARS) {
        setError(
          `Extracted text is very long (${extracted.length.toLocaleString()} chars). Showing the first ${MAX_TEXT_CHARS.toLocaleString()} chars.`
        )
        extracted = extracted.slice(0, MAX_TEXT_CHARS)
      }

      setInputText((prev) => {
        const prevTrimmed = prev.trim()
        if (!prevTrimmed) return extracted
        return `${prevTrimmed}\n\n---\n\n${extracted}`
      })
    } catch (err) {
      setError(
        err instanceof Error
          ? `Failed to extract text from file: ${err.message}`
          : "Failed to extract text from file."
      )
    } finally {
      setIsExtracting(false)
    }
  }

  const handleCopy = async () => {
    if (!output) return

    const nextActions = getMeaningfulNextActions(output)
    let outputText = `${output.title}\n\n${output.summary}\n\n`
    output.sections.forEach((section) => {
      outputText += `${section.heading}\n`
      section.bullets.forEach((bullet) => {
        outputText += `• ${bullet}\n`
      })
      outputText += "\n"
    })
    if (nextActions.length > 0) {
      outputText += "Next Actions\n"
      nextActions.forEach((action) => {
        outputText += `☐ ${action.action}\n`
        outputText += `  First step: ${action.first_step}\n`
      })
    }

    await navigator.clipboard.writeText(outputText)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handlePrint = () => {
    window.print()
  }

  const toggleAction = (index: number) => {
    setCheckedActions((prev) => ({ ...prev, [index]: !prev[index] }))
  }

  return (
    <div className="flex flex-col h-screen bg-background overflow-hidden">
      <header className="shrink-0 border-b border-border/50 bg-card/80 backdrop-blur-md premium-shadow-sm">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between">
            <Link href="/" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground premium-shadow-sm">
                <TransformLogo />
              </div>
              <div>
                <h1 className="text-base font-bold tracking-tight text-foreground">Make This Usable</h1>
              </div>
            </Link>

            <div className="hidden sm:block">
              <p className="text-xs font-medium text-muted-foreground tracking-wide">Turn chaos into clarity</p>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleUseSample}
                className="h-9 px-3 gap-2 text-xs font-semibold hover:bg-primary/10 hover:text-primary transition-all rounded-lg"
              >
                <FileText className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Sample</span>
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleCopy}
                disabled={!hasOutput}
                className={cn(
                  "h-9 w-9 rounded-lg transition-all",
                  hasOutput ? "hover:bg-primary/10 hover:text-primary" : "opacity-30 cursor-not-allowed",
                )}
              >
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                <span className="sr-only">Copy output</span>
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={handlePrint}
                disabled={!hasOutput}
                className={cn(
                  "h-9 w-9 rounded-lg transition-all",
                  hasOutput ? "hover:bg-primary/10 hover:text-primary" : "opacity-30 cursor-not-allowed",
                )}
              >
                <Printer className="h-4 w-4" />
                <span className="sr-only">Print output</span>
              </Button>
              <a
                href="https://buymeacoffee.com/jonyp"
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                  "h-9 px-3 flex items-center gap-2 text-xs font-semibold rounded-lg transition-all",
                  "hover:bg-primary/10 hover:text-primary text-muted-foreground hover:text-primary",
                  "border border-border/50 hover:border-primary/50"
                )}
              >
                <Coffee className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Buy me a coffee</span>
              </a>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-hidden aurora-bg">
        <div className="mx-auto h-full max-w-7xl px-6 py-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-6 h-full">
            <Card className="flex flex-col overflow-hidden border border-border/50 bg-card premium-shadow">
              <div className="shrink-0 px-5 py-4 border-b border-border/50 bg-muted/30">
                <div className="flex items-center justify-between">
                  <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Input</h2>
                  <span className="text-xs font-mono text-muted-foreground/60">{inputText.length} chars</span>
                </div>
              </div>

              <div className="flex-1 flex flex-col p-5 overflow-hidden">
                <div className="mb-3">
                  <input
                    type="file"
                    id="file-upload"
                    accept=".pdf,.csv,image/*"
                    onChange={handleFileUpload}
                    ref={fileInputRef}
                    className="hidden"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className={cn(
                      "w-full h-9 text-xs font-medium transition-all rounded-lg",
                      "hover:bg-primary/10 hover:text-primary hover:border-primary/50 cursor-pointer"
                    )}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Upload className="mr-2 h-3.5 w-3.5" />
                    Upload PDF, Image, or CSV
                  </Button>
                  <p className="mt-1.5 text-xs text-muted-foreground/70 text-center">
                    Max file size: 10MB
                  </p>
                  {isExtracting && (
                    <p className="mt-2 text-xs text-muted-foreground text-center font-medium">
                      Extracting text from file…
                    </p>
                  )}
                  {error && error.includes("too large") && (
                    <p className="mt-2 text-xs text-destructive text-center font-medium">
                      {error}
                    </p>
                  )}
                  {uploadedFileName && (
                    <div className="mt-1.5 flex items-center justify-center gap-2 text-xs text-muted-foreground">
                      <span>Loaded: {uploadedFileName}</span>
                      <button
                        type="button"
                        className="text-primary/70 hover:text-primary transition-colors font-medium"
                        onClick={() => {
                          setSelectedFile(null)
                          setUploadedFileName(null)
                          setIsExtracting(false)
                        }}
                      >
                        Remove
                      </button>
                    </div>
                  )}
                </div>
                <Textarea
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  placeholder={
                    isExtracting
                      ? "Extracting text from your file…"
                      : selectedFile
                      ? "Extracted text from your file will appear here (you can edit it before processing)…"
                      : "Paste any messy text here or upload a document..."
                  }
                  className="flex-1 resize-none border-0 bg-background/50 paper-texture text-sm leading-relaxed focus-visible:ring-2 focus-visible:ring-primary/20 rounded-xl transition-all placeholder:text-muted-foreground/40 p-4"
                />
                <div className="mt-4 flex items-center gap-2">
                  <Button
                    onClick={handleMakeUsable}
                    disabled={(!selectedFile && !inputText.trim()) || isProcessing}
                    className={cn(
                      "flex-1 h-11 font-semibold text-sm transition-all duration-300 rounded-xl premium-shadow-sm",
                      isProcessing
                        ? "bg-primary/80"
                        : "bg-primary hover:bg-primary/90 hover:scale-[1.02] active:scale-[0.98]",
                    )}
                  >
                    {isProcessing ? (
                      <>
                        <Sparkles className="mr-2 h-4 w-4 animate-spin" />
                        Working...
                      </>
                    ) : (
                      <>
                        <Sparkles className="mr-2 h-4 w-4" />
                        Make this usable
                      </>
                    )}
                  </Button>
                </div>
                <button
                  onClick={handleUseSample}
                  className="mt-2 text-xs font-medium text-primary/70 hover:text-primary transition-colors text-center"
                >
                  Use sample
                </button>
              </div>
            </Card>

            <Card className="flex flex-col overflow-hidden border border-border/50 bg-card premium-shadow">
              <div className="shrink-0 px-5 py-4 border-b border-border/50 bg-muted/30">
                <div className="flex items-center justify-between">
                  <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Output</h2>
                  {hasOutput && output && (
                    <div className="flex items-center gap-3">
                      <div className="px-2 py-0.5 rounded-md bg-primary/10 text-primary text-xs font-semibold">
                        Structured
                      </div>
                      <div className="flex items-center gap-1.5">
                        <div className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                        <span className="text-xs font-medium text-primary">Ready</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex-1 overflow-auto p-6">
                {isProcessing && (
                  <div className="space-y-4">
                    <div className="h-8 w-3/4 rounded-lg bg-muted animate-shimmer" />
                    <div
                      className="h-4 w-full rounded-md bg-muted/60 animate-shimmer"
                      style={{ animationDelay: "0.1s" }}
                    />
                    <div
                      className="h-4 w-5/6 rounded-md bg-muted/60 animate-shimmer"
                      style={{ animationDelay: "0.2s" }}
                    />
                    <div className="mt-6 space-y-3">
                      <div
                        className="h-5 w-1/3 rounded-md bg-muted/70 animate-shimmer"
                        style={{ animationDelay: "0.3s" }}
                      />
                      <div
                        className="h-3 w-full rounded-md bg-muted/50 animate-shimmer"
                        style={{ animationDelay: "0.4s" }}
                      />
                      <div
                        className="h-3 w-4/5 rounded-md bg-muted/50 animate-shimmer"
                        style={{ animationDelay: "0.5s" }}
                      />
                      <div
                        className="h-3 w-11/12 rounded-md bg-muted/50 animate-shimmer"
                        style={{ animationDelay: "0.6s" }}
                      />
                    </div>
                  </div>
                )}

                {!isProcessing && !hasOutput && (
                  <div className="flex h-full min-h-[300px] items-center justify-center">
                    <div className="text-center max-w-xs">
                      <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/20 to-accent-color/20 premium-shadow-sm">
                        <Sparkles className="h-10 w-10 text-primary" />
                      </div>
                      <div className="space-y-3 opacity-40">
                        <div className="h-5 w-3/4 mx-auto rounded-md bg-muted" />
                        <div className="h-3 w-full rounded-md bg-muted/70" />
                        <div className="h-3 w-5/6 mx-auto rounded-md bg-muted/70" />
                        <div className="mt-6 space-y-2">
                          <div className="h-4 w-1/2 rounded-md bg-muted/80" />
                          <div className="h-2 w-full rounded-sm bg-muted/50" />
                          <div className="h-2 w-4/5 rounded-sm bg-muted/50" />
                        </div>
                      </div>
                      <p className="mt-6 text-sm font-medium text-muted-foreground">
                        Your structured document will appear here
                      </p>
                    </div>
                  </div>
                )}

                {error && !isProcessing && (
                  <div className="flex h-full min-h-[300px] items-center justify-center">
                    <div className="text-center max-w-xs">
                      <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-destructive/20 premium-shadow-sm">
                        <FileText className="h-10 w-10 text-destructive" />
                      </div>
                      <p className="text-sm font-medium text-destructive mb-4">{error}</p>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleMakeUsable}
                        className="mt-2"
                      >
                        Try again
                      </Button>
                    </div>
                  </div>
                )}

                {!isProcessing && hasOutput && output && (
                  <div className="prose prose-sm max-w-none">
                    {(() => {
                      const nextActions = getMeaningfulNextActions(output)
                      return (
                        <>
                    <h1 className="mb-3 text-2xl font-bold leading-tight text-foreground text-balance">
                      {output.title}
                    </h1>
                    <p className="mb-6 text-sm leading-relaxed text-muted-foreground text-pretty border-l-3 border-primary pl-4 bg-primary/5 py-3 rounded-r-lg">
                      {output.summary}
                    </p>

                    {output.sections.map((section, idx) => (
                      <div key={idx} className="mb-6">
                        <h2 className="mb-3 text-sm font-bold text-primary uppercase tracking-wide flex items-center gap-2">
                          <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                          {section.heading}
                        </h2>
                        <ul className="space-y-2.5 ml-3.5">
                          {section.bullets.map((bullet, itemIdx) => (
                            <li
                              key={itemIdx}
                              className="text-sm leading-relaxed text-card-foreground/90 flex items-start gap-2.5"
                            >
                              <span className="text-primary mt-1.5 font-bold">•</span>
                              <span>{bullet}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}

                    {nextActions.length > 0 && (
                      <div className="mt-8 rounded-xl border border-primary/20 bg-gradient-to-br from-primary/5 to-accent-color/5 p-6 premium-shadow-sm">
                        <h3 className="mb-4 text-sm font-bold text-primary flex items-center gap-2">
                          <Sparkles className="h-4 w-4" />
                          Next Actions
                        </h3>
                        <div className="space-y-3">
                          {nextActions.map((actionItem, idx) => (
                            <div key={idx} className="flex items-start gap-3 group">
                              <Checkbox
                                id={`action-${idx}`}
                                checked={checkedActions[idx] || false}
                                onCheckedChange={() => toggleAction(idx)}
                                className="mt-0.5 border-primary/40 data-[state=checked]:bg-primary data-[state=checked]:border-primary transition-all"
                              />
                              <label
                                htmlFor={`action-${idx}`}
                                className={cn(
                                  "flex-1 text-sm leading-relaxed cursor-pointer select-none transition-all",
                                  checkedActions[idx] ? "line-through opacity-50" : "group-hover:text-primary",
                                )}
                              >
                                <div className="font-medium">{actionItem.action}</div>
                                <div className="text-xs text-muted-foreground mt-0.5">
                                  First step: {actionItem.first_step}
                                </div>
                              </label>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                        </>
                      )
                    })()}
                  </div>
                )}
              </div>
            </Card>
          </div>
        </div>
      </main>
    </div>
  )
}
