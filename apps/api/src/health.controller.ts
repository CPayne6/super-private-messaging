import { Controller, Get, HttpCode, ServiceUnavailableException } from "@nestjs/common";
import { HealthService } from "./health.service.js";
@Controller("health")
export class HealthController {
  constructor(private readonly health: HealthService) {}
  @Get("live") live(): { status: "ok" } { return { status: "ok" }; }
  @Get("ready") @HttpCode(200) async ready(): Promise<{ status: "ok" }> { if (!await this.health.ready()) throw new ServiceUnavailableException({ code: "NOT_READY" }); return { status: "ok" }; }
}
