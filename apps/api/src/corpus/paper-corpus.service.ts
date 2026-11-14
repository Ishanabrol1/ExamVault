/**
 * PaperCorpusService — manages previous-year question corpus import, indexing, and listing.
 * Strictly ADMIN-only. Never exposes bank question content.
 */
import {
  Injectable,
  Logger,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import * as path from 'path';
import * as fs from 'fs';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CryptoService } from '../crypto/crypto.service';
import { ConfigService } from '@nestjs/config';
import {
  parseCorpusFile,
  computeCorpusQuestionHashes,
  MAX_FILE_SIZE_BYTES,
} from './corpus-parser';
import { DisablePaperCorpusInput, DuplicateHandlingInput } from '@examvault/shared';
import { OriginalityService } from '../originality/originality.service';

@Injectable()
export class PaperCorpusService {
  private readonly logger = new Logger(PaperCorpusService.name);

  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private crypto: CryptoService,
    private config: ConfigService,
    private originalityService: OriginalityService,
  ) {}

  /**
   * Validate a corpus file upload (all-or-nothing, no DB changes).
   * Returns validation result including duplicates and 20-row preview.
   */
  async validateUpload(
    buffer: Buffer,
    mimeType: string,
    adminId: string,
    allowUnknownColumns = false,
    sourceLabel = 'Past Papers Archive',
  ) {
    this.logger.log(`CORPUS_VALIDATE admin=${adminId} size=${buffer.length}`);

    // Load existing corpus question hashes for cross-corpus dupe check
    const existingHashes = new Set<string>();
    const existingHashToCorpusId = new Map<string, string>();
    const activeQuestions = await this.prisma.paperCorpusQuestion.findMany({
      where: {
        corpus: { status: 'ACTIVE' },
      },
      select: { combinedHash: true, maskedHash: true, corpusId: true },
    });
    for (const q of activeQuestions) {
      existingHashes.add(q.combinedHash);
      existingHashToCorpusId.set(q.combinedHash, q.corpusId);
      existingHashes.add(q.maskedHash);
      existingHashToCorpusId.set(q.maskedHash, q.corpusId);
    }

    return parseCorpusFile(
      buffer,
      mimeType,
      existingHashes,
      existingHashToCorpusId,
      allowUnknownColumns,
      sourceLabel,
    );
  }

  /**
   * Commit a validated corpus upload (all-or-nothing transaction).
   * Must have zero errors from validateUpload. Called only after admin reviews preview.
   */
  async commitUpload(
    buffer: Buffer,
    mimeType: string,
    name: string,
    licenceNote: string | undefined,
    sourceLabel: string,
    adminId: string,
    dupeHandling: DuplicateHandlingInput = { withinFileStrategy: 'SKIP', crossCorpusStrategy: 'SKIP' },
    allowUnknownColumns = false,
  ) {
    // Re-validate to ensure consistency (never trust client)
    const existingHashes = new Set<string>();
    const existingHashToCorpusId = new Map<string, string>();
    const activeQuestions = await this.prisma.paperCorpusQuestion.findMany({
      where: { corpus: { status: 'ACTIVE' } },
      select: { combinedHash: true, maskedHash: true, corpusId: true },
    });
    for (const q of activeQuestions) {
      existingHashes.add(q.combinedHash);
      existingHashToCorpusId.set(q.combinedHash, q.corpusId);
    }

    const validation = await parseCorpusFile(
      buffer,
      mimeType,
      existingHashes,
      existingHashToCorpusId,
      allowUnknownColumns,
      sourceLabel,
    );

    if (!validation.valid) {
      throw new BadRequestException({
        message: 'File has validation errors. Fix them and re-upload.',
        errors: validation.errors.slice(0, 50),
        errorCount: validation.errorCount,
      });
    }

    // Determine which parsed rows to keep based on dupe handling
    const withinFileDupeRows = new Set(validation.withinFileDupes.map(d => d.key));
    const crossCorpusDupeRows = new Set(validation.crossCorpusDupes.map(d => d.key));

    const seenCombinedHashes = new Set<string>();
    const rowsToInsert = validation.parsedRows.filter((row) => {
      const { combinedHash } = computeCorpusQuestionHashes(row);

      // Cross-corpus dupe
      if (existingHashes.has(combinedHash)) {
        if (dupeHandling.crossCorpusStrategy === 'SKIP') return false;
      }

      // Within-file dupe: skip if already seen
      if (seenCombinedHashes.has(combinedHash)) {
        if (dupeHandling.withinFileStrategy === 'SKIP') return false;
      }
      seenCombinedHashes.add(combinedHash);
      return true;
    });

    // Compute year range and language counts
    const years = rowsToInsert.map((r: any) => r.year as number);
    const yearMin = years.length > 0 ? Math.min(...years) : null;
    const yearMax = years.length > 0 ? Math.max(...years) : null;
    const languageCounts: Record<string, number> = {};
    for (const row of rowsToInsert) {
      const lang = (row as any).language || 'unknown';
      languageCounts[lang] = (languageCounts[lang] || 0) + 1;
    }

    // All-or-nothing transaction with extended timeout for large datasets (up to 200,000 questions)
    const corpus = await this.prisma.$transaction(
      async (tx) => {
        const c = await tx.paperCorpus.create({
          data: {
            name,
            licenceNote: licenceNote || null,
            sourceLabel,
            importedById: adminId,
            questionCount: rowsToInsert.length,
            yearMin,
            yearMax,
            languages: languageCounts,
            status: 'ACTIVE',
            indexStatus: 'PENDING',
          },
        });

        // Batch insert questions (2000 per batch is optimal for Neon Cloud DB)
        const BATCH = 2000;
        for (let i = 0; i < rowsToInsert.length; i += BATCH) {
          const batch = rowsToInsert.slice(i, i + BATCH);
          await tx.paperCorpusQuestion.createMany({
            data: batch.map((row: any) => {
              const hashes = computeCorpusQuestionHashes(row);
              return {
                corpusId: c.id,
                sourceExam:    row.source_exam,
                year:          row.year,
                shift:         row.shift || null,
                paperCode:     row.paper_code || null,
                questionNo:    row.question_no,
                language:      row.language,
                questionType:  row.question_type,
                stem:          row.stem,
                options:       row.options || null,
                subject:       row.subject || null,
                topic:         row.topic || null,
                correctAnswer: row.correct_answer || null,
                stemHash:      hashes.stemHash,
                combinedHash:  hashes.combinedHash,
                maskedHash:    hashes.maskedHash,
              };
            }),
          });
        }

        return c;
      },
      {
        maxWait: 60000,   // Wait up to 60s for DB pool connection
        timeout: 300000,  // 5 minutes timeout for large datasets
      },
    );

    // Audit
    await this.audit.log({
      actorId: adminId,
      action: 'CORPUS_IMPORTED',
      targetType: 'paper_corpus',
      targetId: corpus.id,
      metadata: {
        name,
        sourceLabel,
        questionCount: rowsToInsert.length,
        yearMin,
        yearMax,
        languages: languageCounts,
        dupeHandling,
      },
    });

    // Trigger background index build
    this.triggerIndexBuild(corpus.id).catch(err =>
      this.logger.error(`Index build trigger failed for corpus ${corpus.id}: ${err.message}`),
    );

    return {
      success: true,
      corpusId: corpus.id,
      importedCount: rowsToInsert.length,
      skippedWithinFile: validation.withinFileDupeCount,
      skippedCrossCorpus: validation.crossCorpusDupeCount,
    };
  }

  /**
   * Background index build — idempotent, shows progress, never leaves half-built index active.
   * Calls the Python originality service to ingest corpus questions.
   */
  async triggerIndexBuild(corpusId: string): Promise<void> {
    this.logger.log(`CORPUS_INDEX_BUILD_START corpus=${corpusId}`);

    // Mark as INDEXING
    await this.prisma.paperCorpus.update({
      where: { id: corpusId },
      data: { indexStatus: 'INDEXING', indexProgress: 0, indexError: null },
    });

    try {
      const questions = await this.prisma.paperCorpusQuestion.findMany({
        where: { corpusId },
        select: {
          id: true, sourceExam: true, year: true, shift: true,
          paperCode: true, questionNo: true, language: true,
          stem: true, options: true, corpusId: true,
        },
      });

      const BATCH = 1000;
      let sent = 0;

      const serviceUrl = this.config.get<string>('ORIGINALITY_SERVICE_URL', 'http://localhost:8000');
      const serviceToken = this.config.get<string>('ORIGINALITY_SERVICE_TOKEN', 'examvault_internal_secret_token_dev');
      const getUrl = (p: string) => `${serviceUrl.replace(/\/$/, '')}/${p.replace(/^\//, '')}`;

      // Clear prior documents for this corpus before ingesting new full set
      await fetch(getUrl('corpus/clear'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${serviceToken}`,
        },
        body: JSON.stringify({ corpusId }),
        signal: AbortSignal.timeout(30000),
      }).catch(err => this.logger.warn(`Corpus clear notice: ${err.message}`));

      for (let i = 0; i < questions.length; i += BATCH) {
        const batch = questions.slice(i, i + BATCH);
        const items = batch.map((q) => ({
          docId:           q.id,
          sourceType:      'PAST_PAPER',
          sourceReference: `${q.sourceExam}::${q.year}::${q.questionNo}::${q.language}`,
          versionNo:       1,
          stem:            q.stem,
          options:         Array.isArray(q.options) ? q.options : [],
          parentVersionId: null,
          authorId:        null,
          // Citation metadata for display
          citation: {
            source_exam: q.sourceExam,
            year:        q.year,
            shift:       q.shift,
            paper_code:  q.paperCode,
            question_no: q.questionNo,
          },
        }));

        const res = await fetch(getUrl('corpus/feed'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${serviceToken}`,
          },
          body: JSON.stringify({ corpusId, items, rebuildTfidf: false }),
          signal: AbortSignal.timeout(60000),
        });

        if (!res.ok) {
          throw new Error(`Corpus feed returned HTTP ${res.status}`);
        }

        sent += batch.length;
        const progress = Math.round((sent / questions.length) * 95);
        await this.prisma.paperCorpus.update({
          where: { id: corpusId },
          data: { indexProgress: progress },
        });
      }

      // Finalize corpus TF-IDF matrix
      await fetch(getUrl('corpus/finalize'), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${serviceToken}`,
        },
        signal: AbortSignal.timeout(60000),
      }).catch(err => this.logger.warn(`Corpus finalize notice: ${err.message}`));

      // Mark READY
      await this.prisma.paperCorpus.update({
        where: { id: corpusId },
        data: { indexStatus: 'READY', indexProgress: 100 },
      });

      await this.audit.log({
        actorId: undefined,
        action: 'CORPUS_INDEX_BUILT',
        targetType: 'paper_corpus',
        targetId: corpusId,
        metadata: { questionCount: questions.length },
      });

      this.logger.log(`CORPUS_INDEX_BUILD_DONE corpus=${corpusId} count=${questions.length}`);
    } catch (err: any) {
      this.logger.error(`CORPUS_INDEX_BUILD_FAIL corpus=${corpusId}: ${err.message}`);
      // On failure: mark FAILED, never leave partial active index
      await this.prisma.paperCorpus.update({
        where: { id: corpusId },
        data: { indexStatus: 'FAILED', indexError: err.message },
      });
    }
  }

  /**
   * Disable a corpus (requires step-up MFA already verified by controller).
   * Removes from live index and audits.
   */
  async disableCorpus(
    corpusId: string,
    input: DisablePaperCorpusInput,
    adminId: string,
  ) {
    const corpus = await this.prisma.paperCorpus.findUnique({
      where: { id: corpusId },
    });
    if (!corpus) throw new NotFoundException('Corpus not found');
    if (corpus.status === 'DISABLED') {
      throw new BadRequestException('Corpus is already disabled');
    }

    // Update status
    await this.prisma.paperCorpus.update({
      where: { id: corpusId },
      data: {
        status: 'DISABLED',
        disableReason: input.reason,
        disabledById: adminId,
        disabledAt: new Date(),
      },
    });

    // Remove from live index in originality service
    const questionIds = await this.prisma.paperCorpusQuestion.findMany({
      where: { corpusId },
      select: { id: true },
    });

    const serviceUrl = this.config.get<string>('ORIGINALITY_SERVICE_URL', 'http://localhost:8000');
    const serviceToken = this.config.get<string>('ORIGINALITY_SERVICE_TOKEN', 'examvault_internal_secret_token_dev');
    const getUrl = (p: string) => `${serviceUrl.replace(/\/$/, '')}/${p.replace(/^\//, '')}`;

    try {
      await fetch(getUrl('corpus/disable'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${serviceToken}`,
        },
        body: JSON.stringify({ corpusId }),
        signal: AbortSignal.timeout(10000),
      });
    } catch (e: any) {
      this.logger.warn(`Failed to remove corpus ${corpusId} from live index: ${e.message}`);
    }

    await this.audit.log({
      actorId: adminId,
      action: 'CORPUS_DISABLED',
      targetType: 'paper_corpus',
      targetId: corpusId,
      metadata: { reason: input.reason, questionCount: questionIds.length },
    });

    return { success: true, corpusId, disabledCount: questionIds.length };
  }

  /**
   * List all corpora (admin view).
   * NEVER includes bank question content.
   */
  async listCorpora() {
    return this.prisma.paperCorpus.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        importedBy: { select: { id: true, name: true } },
        disabledBy: { select: { id: true, name: true } },
        _count: { select: { questions: true } },
      },
    });
  }

  /**
   * Get a single corpus with its questions (paginated).
   * Admin-only. NEVER shows bank content.
   */
  async getCorpus(corpusId: string, page = 1, limit = 50) {
    const corpus = await this.prisma.paperCorpus.findUnique({
      where: { id: corpusId },
      include: {
        importedBy: { select: { id: true, name: true } },
      },
    });
    if (!corpus) throw new NotFoundException('Corpus not found');

    const [questions, total] = await Promise.all([
      this.prisma.paperCorpusQuestion.findMany({
        where: { corpusId },
        skip: (page - 1) * limit,
        take: limit,
        orderBy: [{ year: 'asc' }, { questionNo: 'asc' }],
        // Stem is plaintext corpus data (public material), so it's safe to show to admin
        select: {
          id: true, sourceExam: true, year: true, shift: true,
          paperCode: true, questionNo: true, language: true,
          questionType: true, stem: true, options: true,
          subject: true, topic: true,
          // Note: correctAnswer omitted from listing (not needed for display)
        },
      }),
      this.prisma.paperCorpusQuestion.count({ where: { corpusId } }),
    ]);

    return {
      corpus,
      questions,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Download corpus error report as CSV (formula-injection safe).
   */
  async generateErrorReport(errors: any[]): Promise<string> {
    const { escapeCsvCell } = await import('./corpus-parser');
    const lines: string[] = ['Row,Field,Message'];
    for (const e of errors) {
      lines.push([
        escapeCsvCell(String(e.row)),
        escapeCsvCell(e.field),
        escapeCsvCell(e.message),
      ].join(','));
    }
    return lines.join('\r\n');
  }

  /**
   * Retrieve existing combined hashes from active corpora (for cross-corpus dupe check).
   */
  async getExistingHashMaps(): Promise<{ hashes: Set<string>; hashToCorpusId: Map<string, string> }> {
    const hashes = new Set<string>();
    const hashToCorpusId = new Map<string, string>();
    const rows = await this.prisma.paperCorpusQuestion.findMany({
      where: { corpus: { status: 'ACTIVE' } },
      select: { combinedHash: true, maskedHash: true, corpusId: true },
    });
    for (const r of rows) {
      hashes.add(r.combinedHash);
      hashToCorpusId.set(r.combinedHash, r.corpusId);
      hashes.add(r.maskedHash);
      hashToCorpusId.set(r.maskedHash, r.corpusId);
    }
    return { hashes, hashToCorpusId };
  }
}

