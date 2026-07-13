import { Global, Module } from '@nestjs/common';
import { parseServiceConfig } from '@eldercare/config';
import { SERVICE_CONFIG } from '../tokens.js';

@Global()
@Module({
  providers: [
    {
      provide: SERVICE_CONFIG,
      useFactory: () => parseServiceConfig(),
    },
  ],
  exports: [SERVICE_CONFIG],
})
export class AppConfigModule {}
