import { env } from "../env";
import { createInMemoryStore } from "./inmemory";
import type { Store } from "./types";

let singleton: Store | null = null;

export function getStore(): Store {
  if (singleton) return singleton;
  if (env.MARKREEL_STORE === "inmemory") {
    singleton = createInMemoryStore();
    return singleton;
  }

  // Lazy import to avoid requiring Prisma when running in-memory.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { createPrismaStore } = require("./prisma") as typeof import("./prisma");
  singleton = createPrismaStore();
  return singleton;
}
