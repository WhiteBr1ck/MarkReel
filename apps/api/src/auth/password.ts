const bcrypt = require("bcryptjs") as {
  genSalt(rounds?: number): Promise<string>;
  hash(password: string, salt: string): Promise<string>;
  compare(password: string, hash: string): Promise<boolean>;
};

export async function hashPassword(password: string) {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(password, salt);
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}
