/**
 * Hermes — orchestration/coordination MCP server for arf-map.
 *
 * Read-only. Surfaces the project's own coordination metadata so an agent can
 * answer "who can do what" and "where is the documentation" without scanning
 * the filesystem itself:
 *   - list_agents : the specialist subagents defined in .claude/agents/*.md
 *   - get_agent   : one agent's full definition (frontmatter + body)
 *   - list_docs   : the docs/runbooks/architecture tree under docs/**.md
 *
 * Launched as a stdio server from .mcp.json via `npx tsx scripts/hermes-mcp/server.ts`.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readdir, readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");
const AGENTS_DIR = path.join(REPO_ROOT, ".claude", "agents");
const DOCS_DIR = path.join(REPO_ROOT, "docs");

type AgentMeta = { name: string; description: string; file: string };

/** Pull `name:` and `description:` out of a leading `---` YAML frontmatter block. */
function parseFrontmatter(raw: string): { name?: string; description?: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const body = match[1];
  const read = (key: string): string | undefined => {
    const line = body.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
    return line ? line[1].trim().replace(/^["']|["']$/g, "") : undefined;
  };
  return { name: read("name"), description: read("description") };
}

async function loadAgents(): Promise<AgentMeta[]> {
  const entries = await readdir(AGENTS_DIR);
  const agents: AgentMeta[] = [];
  for (const file of entries.filter((f) => f.endsWith(".md"))) {
    const raw = await readFile(path.join(AGENTS_DIR, file), "utf8");
    const fm = parseFrontmatter(raw);
    agents.push({
      name: fm.name ?? path.basename(file, ".md"),
      description: fm.description ?? "",
      file: path.join(".claude", "agents", file),
    });
  }
  return agents.sort((a, b) => a.name.localeCompare(b.name));
}

/** Recursively collect *.md files under a directory, returning repo-relative paths. */
async function walkMarkdown(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walkMarkdown(abs)));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      out.push(path.relative(REPO_ROOT, abs).split(path.sep).join("/"));
    }
  }
  return out.sort();
}

/** First markdown H1 (`# Title`) in a file, for a human-readable label. */
async function firstHeading(relPath: string): Promise<string> {
  try {
    const raw = await readFile(path.join(REPO_ROOT, relPath), "utf8");
    const h1 = raw.match(/^#\s+(.+)$/m);
    return h1 ? h1[1].trim() : "";
  } catch {
    return "";
  }
}

const ok = (text: string) => ({ content: [{ type: "text" as const, text }] });
const fail = (text: string) => ({ content: [{ type: "text" as const, text }], isError: true });

const server = new McpServer({ name: "hermes", version: "1.0.0" });

server.registerTool(
  "list_agents",
  {
    title: "List arf-map agents",
    description:
      "List the specialist subagents defined for this project (.claude/agents/*.md), " +
      "with each agent's name and description. Use this to decide which agent should own a task.",
    inputSchema: {},
  },
  async () => {
    try {
      const agents = await loadAgents();
      if (agents.length === 0) return ok("No agents found in .claude/agents/.");
      const lines = agents.map((a) => `- ${a.name} (${a.file})\n    ${a.description}`);
      return ok(`${agents.length} agents:\n\n${lines.join("\n")}`);
    } catch (err) {
      return fail(`Failed to list agents: ${(err as Error).message}`);
    }
  },
);

server.registerTool(
  "get_agent",
  {
    title: "Get an agent definition",
    description:
      "Return the full definition (frontmatter + instructions) for one agent by its name, " +
      "e.g. 'team-lead' or 'backend-engineer'. Use list_agents first to see valid names.",
    inputSchema: { name: z.string().min(1).describe("Agent name, e.g. 'architect'") },
  },
  async ({ name }) => {
    try {
      const agents = await loadAgents();
      const match = agents.find((a) => a.name === name);
      if (!match) {
        return fail(
          `No agent named '${name}'. Available: ${agents.map((a) => a.name).join(", ")}`,
        );
      }
      // Resolve via the vetted list, never from raw input — no path traversal.
      const raw = await readFile(path.join(REPO_ROOT, match.file), "utf8");
      return ok(raw);
    } catch (err) {
      return fail(`Failed to read agent '${name}': ${(err as Error).message}`);
    }
  },
);

server.registerTool(
  "list_docs",
  {
    title: "List project docs",
    description:
      "List the project's documentation and runbooks (docs/**/*.md) with their repo-relative " +
      "path and H1 title. Use to find architecture notes, runbooks, and operations docs.",
    inputSchema: {},
  },
  async () => {
    try {
      await stat(DOCS_DIR);
      const files = await walkMarkdown(DOCS_DIR);
      if (files.length === 0) return ok("No markdown docs found under docs/.");
      const lines = await Promise.all(
        files.map(async (f) => {
          const title = await firstHeading(f);
          return title ? `- ${f} — ${title}` : `- ${f}`;
        }),
      );
      return ok(`${files.length} docs:\n\n${lines.join("\n")}`);
    } catch (err) {
      return fail(`Failed to list docs: ${(err as Error).message}`);
    }
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdio servers must not write to stdout (it's the JSON-RPC channel); log to stderr.
  console.error("[hermes] MCP server connected over stdio");
}

main().catch((err) => {
  console.error("[hermes] fatal:", err);
  process.exit(1);
});
