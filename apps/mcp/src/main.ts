import { readFile } from "node:fs/promises";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { MarkReelClient } from "./client.js";
import { readConfig } from "./config.js";
import { createMcpServer } from "./server.js";

async function main() {
  const config = readConfig();
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
  const server = createMcpServer(new MarkReelClient(config), packageJson.version);
  await server.connect(new StdioServerTransport());
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "MarkReel MCP failed to start");
  process.exitCode = 1;
});
