import { Controller, Get, Header } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AppService } from './app.service';
import { livenessPayload, type LivenessPayload } from './liveness';

@ApiTags('health')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @ApiOperation({ summary: 'فحص حياة الخدمة' })
  @ApiOkResponse({ description: 'الخدمة تستجيب.', type: String })
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('api/liveness')
  @Header('Cache-Control', 'no-store, max-age=0')
  @ApiOperation({ summary: 'إصدار الخدمة العامل الآن' })
  @ApiOkResponse({ description: 'الخدمة حيّة، مع أول ١٢ خانة من إصدارها.' })
  getLiveness(): LivenessPayload {
    return livenessPayload();
  }
}
