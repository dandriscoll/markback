import * as path from "node:path";

const MB_SUFFIX = ".mb";

export function sidecarPathFor(sourcePath: string): string {
  return sourcePath + MB_SUFFIX;
}

export function isSidecar(filePath: string): boolean {
  return filePath.endsWith(MB_SUFFIX);
}

export function sourcePathFor(sidecar: string): string | null {
  if (!isSidecar(sidecar)) return null;
  return sidecar.slice(0, -MB_SUFFIX.length);
}

export function relativeFromSidecar(sourceAbsPath: string, sidecarAbsPath: string): string {
  const sidecarDir = path.dirname(sidecarAbsPath);
  const rel = path.relative(sidecarDir, sourceAbsPath);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    return rel;
  }
  return "./" + rel;
}
