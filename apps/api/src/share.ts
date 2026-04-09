import crypto from "node:crypto";

export function sha256Hex(input: string) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export function newShareToken() {
  return crypto.randomBytes(24).toString("base64url");
}
