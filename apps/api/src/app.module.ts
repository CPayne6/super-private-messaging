import { Module, OnApplicationShutdown } from "@nestjs/common";
import { createClient } from "redis";
import { runtimeConfig } from "./config.js";
import { DatabaseModule } from "./database.module.js";
import { HealthController } from "./health.controller.js";
import { HealthService, type RedisHealthClient } from "./health.service.js";
import { SimpleMessagesController } from "./simple-messages.controller.js";
import { REDIS } from "./tokens.js";

@Module({
  imports: [DatabaseModule],
  controllers: [HealthController, SimpleMessagesController],
  providers: [
    {
      provide: REDIS,
      useFactory: async (): Promise<RedisHealthClient> => {
        const client = createClient({
          url: runtimeConfig().redisUrl,
          socket: { connectTimeout: 3000 },
        });
        await client.connect();
        return client;
      },
    },
    HealthService,
    {
      provide: "REDIS_SHUTDOWN",
      useFactory: (redis: RedisHealthClient) => new RedisShutdown(redis),
      inject: [REDIS],
    },
  ],
})
export class AppModule {}

class RedisShutdown implements OnApplicationShutdown {
  constructor(private readonly redis: RedisHealthClient) {}
  onApplicationShutdown(): Promise<string> {
    return this.redis.quit();
  }
}
