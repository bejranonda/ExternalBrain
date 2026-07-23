export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";

  const units = ["B", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];
  const base = 1024;
  const exponent = Math.min(
    Math.floor(Math.log(Math.abs(bytes)) / Math.log(base)),
    units.length - 1
  );

  const value = bytes / Math.pow(base, exponent);
  const formatted = parseFloat(value.toFixed(2));

  return `${formatted} ${units[exponent]}`;
}
