export function serializeSizeBytes(value: number | bigint | null | undefined) {
  if (typeof value === "bigint") return Number(value);
  return value ?? undefined;
}

export function serializeMediaFile<T extends { sizeBytes?: number | bigint | null }>(file: T): Omit<T, "sizeBytes"> & { sizeBytes?: number } {
  return {
    ...file,
    sizeBytes: serializeSizeBytes(file.sizeBytes)
  };
}

export function serializeMediaFiles<T extends { sizeBytes?: number | bigint | null }>(files: T[]) {
  return files.map(serializeMediaFile);
}

export function serializeMediaMetadata<T extends { sizeBytes?: number | bigint | null }>(metadata: T): Omit<T, "sizeBytes"> & { sizeBytes?: number } {
  return serializeMediaFile(metadata);
}
