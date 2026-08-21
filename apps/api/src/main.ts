import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import helmet from "helmet";
import type { CorsOptions } from "@nestjs/common/interfaces/external/cors-options.interface.js";
import { AppModule } from "./app.module.js";
import { runtimeConfig } from "./config.js";
import { HealthService } from "./health.service.js";
import { NativeWebSocketServer } from "./native-websocket.js";
import { SimpleMessagesController } from "./simple-messages.controller.js";
import { DatabaseService } from "./database.module.js";
async function bootstrap(): Promise<void> {
  const config = runtimeConfig();
  const app = await NestFactory.create(AppModule, { bodyParser: true });
  app
    .getHttpAdapter()
    .getInstance()
    .set("trust proxy", config.trustProxy ? 1 : false);
  app.use(
    helmet({
      contentSecurityPolicy: false,
      hsts: config.production ? undefined : false,
      crossOriginEmbedderPolicy: false,
    }),
  );
  const cors: CorsOptions = {
    origin: (
      origin: string | undefined,
      callback: (error: Error | null, allow?: boolean) => void,
    ) => callback(null, !origin || config.allowedOrigins.includes(origin)),
    methods: ["GET", "POST", "DELETE"],
    allowedHeaders: ["content-type"],
    credentials: false,
    maxAge: 600,
  };
  app.enableCors(cors);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: false,
    }),
  );
  app.enableShutdownHooks();
  const health = app.get(HealthService);
  const shutdown = async () => {
    health.stopAccepting();
    await app.close();
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
  const realtime = new NativeWebSocketServer(
    app.getHttpServer(),
    app.get(DatabaseService),
    config,
  );
  app.get(SimpleMessagesController).setRealtime(realtime);
  await app.listen(config.port, "0.0.0.0");
}
void bootstrap();
