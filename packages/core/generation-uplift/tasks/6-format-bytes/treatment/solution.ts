export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes)) {
    throw new RangeError(`formatBytes: expected a finite number, got ${bytes}`);
  }
  if (bytes < 0) {
    throw new RangeError(`formatBytes: byte count cannot be negative, got ${bytes}`);
  }
  if (bytes === 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / Math.pow(1024, exponent);
  const rounded = Math.round(value * 100) / 100;

  return `${rounded} ${units[exponent]}`;
}
