// TypeScript 声明文件 — 无 @types 包的模块

declare module 'sql.js' {
  interface SqlJsStatic {
    Database: new (data?: ArrayLike<number> | Buffer | null) => Database;
  }
  interface Database {
    run(sql: string, params?: any[]): void;
    prepare(sql: string): Statement;
    exec(sql: string): QueryExecResult[];
    export(): Uint8Array;
    close(): void;
    getRowsModified(): number;
  }
  interface Statement {
    bind(params?: any[]): boolean;
    step(): boolean;
    getAsObject(): Record<string, any>;
    free(): boolean;
    reset(): void;
  }
  interface QueryExecResult {
    columns: string[];
    values: any[][];
  }
  export default function initSqlJs(config?: any): Promise<SqlJsStatic>;
}

declare module 'node-cron' {
  import { ScheduledTask } from 'node-cron';
  export function schedule(expression: string, func: () => void, options?: any): ScheduledTask;
  export function validate(expression: string): boolean;
}
