export class TFile {
  path = "";
  extension = "";
  basename = "";
}

export class App {}

export function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+/g, "/");
}
