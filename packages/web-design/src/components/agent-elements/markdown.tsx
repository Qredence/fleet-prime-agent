"use client"

import { Streamdown } from "streamdown"
import { createCodePlugin } from "@streamdown/code"
import { cn } from "./utils/cn"
import type { Components } from "streamdown"

function fixNumberedListBreaks(text: string): string {
  return text.replace(/^(\d+)\.\s*\n+\s*\n*/gm, "$1. ")
}

const CODE_FENCE_LANGS = new Set([
  "bash",
  "diff",
  "html",
  "js",
  "json",
  "jsx",
  "md",
  "markdown",
  "sh",
  "shell",
  "text",
  "ts",
  "tsx",
  "yml",
  "yaml",
])

function normalizeCodeFenceLanguages(text: string): string {
  return text.replace(/```([^\n]*)/g, (_match, langRaw) => {
    const lang = String(langRaw || "")
      .trim()
      .toLowerCase()
    if (!lang) return "```"
    const normalized = lang.split(/\s+/)[0]
    return CODE_FENCE_LANGS.has(normalized) ? `\`\`\`${normalized}` : "```text"
  })
}

export type MarkdownProps = {
  content: string
  className?: string
  textContrast?: "normal" | "high"
}

const code = createCodePlugin({
  themes: ["github-light", "github-dark"],
})

export function Markdown({ content, className }: MarkdownProps) {
  const safeContent = normalizeCodeFenceLanguages(
    fixNumberedListBreaks(content)
  )
  const components: Components = {
    h1: ({ children, ...props }) => (
      <h1 className="an-md-h1 mt-3 mb-1.5 text-base font-semibold" {...props}>
        {children}
      </h1>
    ),
    h2: ({ children, ...props }) => (
      <h2 className="an-md-h2 mt-3 mb-1.5 text-base font-semibold" {...props}>
        {children}
      </h2>
    ),
    h3: ({ children, ...props }) => (
      <h3 className="an-md-h3 mt-2 mb-1 text-sm font-semibold" {...props}>
        {children}
      </h3>
    ),
    h4: ({ children, ...props }) => (
      <h4 className="an-md-h4 mt-2 mb-1 text-sm font-medium" {...props}>
        {children}
      </h4>
    ),
    p: ({ children, ...props }) => (
      <p
        className="an-md-p text-sm leading-relaxed text-an-foreground/80"
        {...props}
      >
        {children}
      </p>
    ),
    ul: ({ children, ...props }) => (
      <ul
        className="an-md-ul mb-2 flex list-outside list-disc flex-col gap-0.5 pl-4 text-sm text-an-foreground/80"
        {...props}
      >
        {children}
      </ul>
    ),
    ol: ({ children, ...props }) => (
      <ol
        className="an-md-ol mb-2 flex list-outside list-decimal flex-col gap-0.5 pl-5 text-sm text-an-foreground/80"
        {...props}
      >
        {children}
      </ol>
    ),
    li: ({ children, ...props }) => (
      <li className="an-md-li pl-0.5 text-sm text-an-foreground/80" {...props}>
        {children}
      </li>
    ),
    strong: ({ children, ...props }) => (
      <strong className="font-medium text-an-foreground" {...props}>
        {children}
      </strong>
    ),
    a: ({ href, children, ...props }) => {
      if (!href) return <span>{children}</span>
      const isExternal = href.startsWith("http") || href.startsWith("mailto:")
      return (
        <a
          {...props}
          href={href}
          target={isExternal ? "_blank" : undefined}
          rel={isExternal ? "noopener noreferrer" : undefined}
          className="an-md-link text-an-primary-color underline-offset-2 hover:underline"
        >
          {children}
        </a>
      )
    },
    blockquote: ({ children, ...props }) => (
      <blockquote
        className="an-md-blockquote mb-2 border-l-2 border-an-border-color pl-3 text-sm text-an-foreground/70 italic"
        {...props}
      >
        {children}
      </blockquote>
    ),
    hr: ({ ...props }) => (
      <hr className="an-md-hr my-4 border-an-border-color" {...props} />
    ),
    table: ({ children, ...props }) => (
      <div className="my-3 overflow-x-auto rounded-an-tool-border-radius border border-an-border-color">
        <table
          className="an-md-table w-full text-sm [&>thead]:bg-an-tool-background [&>thead>tr>th]:bg-an-tool-background"
          {...props}
        >
          {children}
        </table>
      </div>
    ),
    th: ({ children, ...props }) => (
      <th
        className="bg-an-background-secondary px-3 py-2 text-left font-medium"
        {...props}
      >
        {children}
      </th>
    ),
    td: ({ children, ...props }) => (
      <td
        className="border-t border-an-border-color px-3 py-2 text-an-foreground/80"
        {...props}
      >
        {children}
      </td>
    ),
  }

  return (
    <div
      className={cn(
        "an-markdown",
        "overflow-hidden wrap-break-word",
        "[&_li>p]:mb-0 [&_li>p]:inline",
        className
      )}
    >
      <Streamdown components={components} plugins={{ code }}>
        {safeContent}
      </Streamdown>
    </div>
  )
}
