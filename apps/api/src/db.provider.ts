import type { Provider } from '@nestjs/common';
import { createDb, createPool, type Db } from '@ai-system/db';

export const DB = Symbol('DB');

export const dbProvider: Provider = {
  provide: DB,
  useFactory: (): Db => createDb(createPool()),
};
