import path from "node:path";
import { z } from "zod";

const ConfigSchema = z.object({
  MARKREEL_MCP_BASE_URL: z.string().url().default("http://localhost:5090"),
  MARKREEL_MCP_USERNAME: z.string().trim().min(3).max(32).optional(),
  MARKREEL_MCP_PASSWORD: z.string().min(8).max(200).optional(),
  MARKREEL_MCP_API_TOKEN: z.string().regex(/^mr_token_[A-Za-z0-9_-]{43}$/).optional(),
  MARKREEL_MCP_READ_ONLY: z.enum(["true", "false"]).default("false"),
  MARKREEL_MCP_UPLOAD_ROOTS: z.string().optional(),
  MARKREEL_MCP_TRANSFER_TIMEOUT_SECONDS: z.coerce.number().int().min(30).max(86400).default(3600)
}).refine((value) => value.MARKREEL_MCP_API_TOKEN || (value.MARKREEL_MCP_USERNAME && value.MARKREEL_MCP_PASSWORD), {
  message: "Configure an API token or username and password", path: ["MARKREEL_MCP_API_TOKEN"]
});

export function readConfig(values: NodeJS.ProcessEnv = process.env) {
  const parsed = ConfigSchema.safeParse(values);
  if (!parsed.success) {
    throw new Error(`Invalid MCP configuration: ${parsed.error.issues.map((issue) => issue.path.join(".")).join(", ")}`);
  }
  const input = parsed.data;
  const url = new URL(input.MARKREEL_MCP_BASE_URL);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("MARKREEL_MCP_BASE_URL must be an HTTP(S) address without credentials, query or fragment");
  }
  return {
    baseUrl: url.href.replace(/\/+$/, "").replace(/\/api$/, ""),
    username: input.MARKREEL_MCP_USERNAME ?? "",
    password: input.MARKREEL_MCP_PASSWORD ?? "",
    apiToken: input.MARKREEL_MCP_API_TOKEN,
    readOnly: input.MARKREEL_MCP_READ_ONLY === "true",
    uploadRoots: input.MARKREEL_MCP_UPLOAD_ROOTS?.split(path.delimiter).map((root) => root.trim()).filter(Boolean) ?? [],
    transferTimeoutMs: input.MARKREEL_MCP_TRANSFER_TIMEOUT_SECONDS * 1000
  };
}

export type McpConfig = ReturnType<typeof readConfig>;
