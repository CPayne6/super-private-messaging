import { Global, Injectable, Module, OnApplicationShutdown } from "@nestjs/common";
import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { runtimeConfig } from "./config.js";

@Injectable()
export class DatabaseService implements OnApplicationShutdown {
  private readonly pool = new Pool({ connectionString: runtimeConfig().databaseUrl, max: 10, connectionTimeoutMillis: 3000, query_timeout: 5000 });
  query<T extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]) { return this.pool.query<T>(text, values as unknown[]); }
  connect(): Promise<PoolClient> { return this.pool.connect(); }
  onApplicationShutdown(): Promise<void> { return this.pool.end(); }
}

@Global()
@Module({ providers: [DatabaseService], exports: [DatabaseService] })
export class DatabaseModule {}
