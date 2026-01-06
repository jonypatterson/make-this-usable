"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Card } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Copy, Printer, FileText, Sparkles, Check, Upload, Loader2, Coffee } from "lucide-react"
import { cn } from "@/lib/utils"
import { z } from "zod"

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


export default function MakeThisUsablePage() {
  const [inputText, setInputText] = useState("")
  const [isProcessing, setIsProcessing] = useState(false)
  const [hasOutput, setHasOutput] = useState(false)
  const [copied, setCopied] = useState(false)
  const [checkedActions, setCheckedActions] = useState<Record<number, boolean>>({})
  const [output, setOutput] = useState<TransformResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isExtracting, setIsExtracting] = useState(false)
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null)

  const handleMakeUsable = async () => {
    if (!inputText.trim()) return

    setIsProcessing(true)
    setHasOutput(false)
    setError(null)
    setCheckedActions({})
    setOutput(null)

    try {
      const response = await fetch("/api/transform", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text: inputText }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || "Failed to transform text")
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
    setUploadedFileName(null)
  }

  const extractTextFromPDF = async (file: File): Promise<string> => {
    const pdfjsLib = await import("pdfjs-dist")
    pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`
    
    const arrayBuffer = await file.arrayBuffer()
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
    let fullText = ""

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i)
      const textContent = await page.getTextContent()
      const pageText = textContent.items
        .map((item: any) => item.str)
        .join(" ")
      fullText += pageText + "\n\n"
    }

    return fullText
  }

  const extractTextFromImage = async (file: File): Promise<string> => {
    const Tesseract = await import("tesseract.js")
    const { data } = await Tesseract.recognize(file, "eng", {
      logger: (m) => {
        if (m.status === "recognizing text") {
          // Progress updates can be shown here if needed
        }
      },
    })
    return data.text
  }

  const extractTextFromCSV = async (file: File): Promise<string> => {
    const Papa = await import("papaparse")
    const text = await file.text()
    
    return new Promise((resolve, reject) => {
      Papa.parse(text, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          // Convert CSV data to readable text format
          let csvText = ""
          if (results.data && results.data.length > 0) {
            // Add headers
            const headers = Object.keys(results.data[0] as any)
            csvText += headers.join(" | ") + "\n"
            csvText += "-".repeat(headers.join(" | ").length) + "\n"
            
            // Add rows
            results.data.forEach((row: any) => {
              csvText += headers.map((h) => row[h] || "").join(" | ") + "\n"
            })
          }
          resolve(csvText)
        },
        error: (error: Error) => {
          reject(new Error(`CSV parsing error: ${error.message}`))
        },
      })
    })
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
      setError(
        `File is too large. Maximum size: ${formatFileSize(maxSize)}. Your file: ${formatFileSize(file.size)}.`
      )
      event.target.value = ""
      return
    }

    setIsExtracting(true)
    setError(null)
    setUploadedFileName(file.name)
    setHasOutput(false)

    try {
      let extractedText = ""

      if (file.type === "application/pdf") {
        extractedText = await extractTextFromPDF(file)
      } else if (file.type.startsWith("image/")) {
        extractedText = await extractTextFromImage(file)
      } else if (
        file.type === "text/csv" ||
        file.name.endsWith(".csv")
      ) {
        extractedText = await extractTextFromCSV(file)
      } else {
        // Try to read as plain text
        extractedText = await file.text()
      }

      if (!extractedText.trim()) {
        throw new Error("No text could be extracted from this file.")
      }

      setInputText(extractedText)
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to extract text from file. Please try another file."
      )
      setUploadedFileName(null)
    } finally {
      setIsExtracting(false)
      // Reset file input
      event.target.value = ""
    }
  }

  const handleCopy = async () => {
    if (!output) return

    let outputText = `${output.title}\n\n${output.summary}\n\n`
    output.sections.forEach((section) => {
      outputText += `${section.heading}\n`
      section.bullets.forEach((bullet) => {
        outputText += `• ${bullet}\n`
      })
      outputText += "\n"
    })
    outputText += "Next Actions\n"
    output.next_actions.forEach((action) => {
      outputText += `☐ ${action.action}\n`
      outputText += `  First step: ${action.first_step}\n`
    })

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
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground premium-shadow-sm">
                <TransformLogo />
              </div>
              <div>
                <h1 className="text-base font-bold tracking-tight text-foreground">Make This Usable</h1>
              </div>
            </div>

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
                href="https://buymeacoffee.com/yourusername"
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
                    className="hidden"
                    disabled={isExtracting}
                  />
                  <label htmlFor="file-upload" className="cursor-pointer">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={isExtracting}
                      className={cn(
                        "w-full h-9 text-xs font-medium transition-all rounded-lg",
                        isExtracting
                          ? "opacity-50 cursor-not-allowed"
                          : "hover:bg-primary/10 hover:text-primary hover:border-primary/50 cursor-pointer"
                      )}
                      onClick={() => {
                        if (!isExtracting) {
                          document.getElementById("file-upload")?.click()
                        }
                      }}
                    >
                      {isExtracting ? (
                        <>
                          <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                          Extracting text...
                        </>
                      ) : (
                        <>
                          <Upload className="mr-2 h-3.5 w-3.5" />
                          Upload PDF, Image, or CSV
                        </>
                      )}
                    </Button>
                  </label>
                  <p className="mt-1.5 text-xs text-muted-foreground/70 text-center">
                    Max file size: 10MB
                  </p>
                  {uploadedFileName && (
                    <p className="mt-1.5 text-xs text-muted-foreground text-center">
                      Loaded: {uploadedFileName}
                    </p>
                  )}
                </div>
                <Textarea
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  placeholder="Paste any messy text here or upload a document..."
                  className="flex-1 resize-none border-0 bg-background/50 paper-texture text-sm leading-relaxed focus-visible:ring-2 focus-visible:ring-primary/20 rounded-xl transition-all placeholder:text-muted-foreground/40 p-4"
                />
                <div className="mt-4 flex items-center gap-2">
                  <Button
                    onClick={handleMakeUsable}
                    disabled={!inputText.trim() || isProcessing}
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

                    <div className="mt-8 rounded-xl border border-primary/20 bg-gradient-to-br from-primary/5 to-accent-color/5 p-6 premium-shadow-sm">
                      <h3 className="mb-4 text-sm font-bold text-primary flex items-center gap-2">
                        <Sparkles className="h-4 w-4" />
                        Next Actions
                      </h3>
                      <div className="space-y-3">
                        {output.next_actions.map((actionItem, idx) => (
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
