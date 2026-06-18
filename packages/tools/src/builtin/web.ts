import { obj, type Tool, type ToolResult } from "../tool.ts"

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim()
}

export const webfetchTool: Tool = {
  name: "webfetch",
  description: "Fetch a URL and return its text content (HTML is stripped to plain text).",
  permission: "network",
  parameters: obj(
    {
      url: { type: "string", description: "the URL to fetch" },
      prompt: { type: "string", description: "(optional) what you're looking for" },
    },
    ["url"],
  ),
  async execute(input, ctx): Promise<ToolResult> {
    let url: string = input.url
    if (!/^https?:\/\//.test(url)) url = `https://${url}`
    try {
      const res = await fetch(url, {
        signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(15_000)]),
        headers: { "user-agent": "FridayCode/0.1" },
      })
      if (!res.ok) return { output: `HTTP ${res.status} for ${url}`, isError: true, title: `webfetch ${url}` }
      const ct = res.headers.get("content-type") ?? ""
      const raw = await res.text()
      const text = ct.includes("html") ? htmlToText(raw) : raw
      const clipped = text.length > 20_000 ? `${text.slice(0, 20_000)}\n… (truncated)` : text
      return { output: clipped, title: `webfetch ${url}` }
    } catch (e: any) {
      return { output: `Error fetching ${url}: ${e.message}`, isError: true, title: `webfetch ${url}` }
    }
  },
}

export const websearchTool: Tool = {
  name: "websearch",
  description: "Search the web and return a list of result titles, URLs and snippets.",
  permission: "network",
  parameters: obj({ query: { type: "string", description: "search query" } }, ["query"]),
  async execute(input, ctx): Promise<ToolResult> {
    const q = encodeURIComponent(input.query)
    try {
      const res = await fetch(`https://html.duckduckgo.com/html/?q=${q}`, {
        signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(15_000)]),
        headers: { "user-agent": "Mozilla/5.0 FridayCode/0.1" },
      })
      const html = await res.text()
      const results: string[] = []
      const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g
      let m: RegExpExecArray | null
      while ((m = re.exec(html)) && results.length < 10) {
        const href = decodeURIComponent(m[1]!.match(/uddg=([^&]+)/)?.[1] ?? m[1]!)
        const title = htmlToText(m[2]!)
        results.push(`${title}\n  ${href}`)
      }
      if (!results.length) return { output: `No results for "${input.query}".`, title: `websearch ${input.query}` }
      return { output: results.join("\n\n"), title: `websearch ${input.query} (${results.length})` }
    } catch (e: any) {
      return { output: `Error searching: ${e.message}`, isError: true, title: `websearch ${input.query}` }
    }
  },
}
