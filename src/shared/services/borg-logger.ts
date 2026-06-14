import { BorgExecutionContext } from "../types";

export class BorgLogger {
  constructor(
    private scope: string,
    private db: D1Database,
    private traceId: string,
    private ctx: BorgExecutionContext
  ) {}

  info(tag: string, message: string) {
    console.log(`[${this.scope}][${this.traceId}][INFO][${tag}] ${message}`);
  }

  error(tag: string, message: string) {
    console.error(`[${this.scope}][${this.traceId}][ERROR][${tag}] ${message}`);
  }
}
