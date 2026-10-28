import {
  Controller,
  Get,
  Header,
  Headers,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { createHash, timingSafeEqual } from 'node:crypto';
import { DatabaseReadinessService } from './database-readiness';

@ApiTags('health')
@Controller('api/readiness')
export class ReadinessController {
  constructor(private readonly database: DatabaseReadinessService) {}

  @Get()
  @Header('Cache-Control', 'no-store, max-age=0')
  @ApiHeader({ name: 'x-readiness-probe-secret', required: true })
  @ApiOperation({
    summary: 'فحص اتصال قاعدة المنصة ومخططها الأساسي، للخادم فقط',
  })
  async readiness(@Headers('x-readiness-probe-secret') provided?: string) {
    const expected = process.env.READINESS_PROBE_SECRET?.trim();
    if (!expected || expected.length < 32 || expected.length > 512) {
      throw new HttpException(
        { ready: false, code: 'READINESS_NOT_CONFIGURED' },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    const digest = (value: string) =>
      createHash('sha256').update(value).digest();
    if (
      typeof provided !== 'string' ||
      provided.length > 512 ||
      !timingSafeEqual(digest(provided), digest(expected))
    ) {
      throw new HttpException(
        { ready: false, code: 'UNAUTHORIZED' },
        HttpStatus.UNAUTHORIZED,
      );
    }
    const result = await this.database.check();
    if (!result.ready)
      throw new HttpException(result, HttpStatus.SERVICE_UNAVAILABLE);
    return { ...result, scope: 'database-connectivity-and-core-schema' };
  }
}
