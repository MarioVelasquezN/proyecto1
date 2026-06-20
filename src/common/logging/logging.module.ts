import { Global, Module } from '@nestjs/common';
import { LoggingInterceptor } from './logging.interceptor';

@Global()
@Module({
  providers: [LoggingInterceptor],
  exports: [LoggingInterceptor],
})
export class LoggingModule {}
