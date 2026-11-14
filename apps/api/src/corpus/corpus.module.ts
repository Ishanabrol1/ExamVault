import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { CorpusService } from './corpus.service';
import { CorpusController } from './corpus.controller';
import { PaperCorpusService } from './paper-corpus.service';
import { PaperCorpusController } from './paper-corpus.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { OriginalityModule } from '../originality/originality.module';
import { CryptoModule } from '../crypto/crypto.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    PrismaModule,
    AuditModule,
    OriginalityModule,
    CryptoModule,
    AuthModule,
    MulterModule.register(),
  ],
  controllers: [CorpusController, PaperCorpusController],
  providers: [CorpusService, PaperCorpusService],
  exports: [CorpusService, PaperCorpusService],
})
export class CorpusModule {}

