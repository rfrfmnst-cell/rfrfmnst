import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';
import { applyApiSecurity } from './security';
import { API_DOCS_PATH, setupSwagger } from './swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  applyApiSecurity(app);

  const docsMounted = setupSwagger(app);

  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port);

  if (docsMounted) {
    console.log(`OpenAPI docs: http://localhost:${port}/${API_DOCS_PATH}`);
  }
}

void bootstrap();
