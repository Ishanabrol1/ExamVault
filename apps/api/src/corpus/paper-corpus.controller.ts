/**
 * PaperCorpusController — ADMIN-only endpoints for previous-year corpus management.
 * Uses multer for multipart file upload; enforces size limits in middleware.
 */
import {
  Controller,
  Post,
  Get,
  Patch,
  Param,
  Body,
  Req,
  Res,
  UseInterceptors,
  UploadedFile,
  Query,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiConsumes } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { Roles } from '../auth/auth.guard';
import { PaperCorpusService } from './paper-corpus.service';
import { AuthService } from '../auth/auth.service';
import {
  DisablePaperCorpusSchema,
  DuplicateHandlingSchema,
} from '@examvault/shared';
import { PrismaService } from '../prisma/prisma.service';
import { MAX_FILE_SIZE_BYTES } from './corpus-parser';

@ApiTags('Paper Corpus')
@Controller('corpus/paper-corpora')
export class PaperCorpusController {
  constructor(
    private paperCorpusService: PaperCorpusService,
    private authService: AuthService,
    private prisma: PrismaService,
  ) {}

  /** List all corpora */
  @Get()
  @Roles('ADMIN')
  @ApiOperation({ summary: 'List all previous-year paper corpora (ADMIN only)' })
  async listCorpora() {
    const corpora = await this.paperCorpusService.listCorpora();
    return { success: true, data: corpora };
  }

  /** Get a single corpus with questions */
  @Get(':corpusId')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Get corpus with paginated questions (ADMIN only)' })
  async getCorpus(
    @Param('corpusId') corpusId: string,
    @Query('page') page = '1',
    @Query('limit') limit = '50',
  ) {
    const result = await this.paperCorpusService.getCorpus(
      corpusId,
      parseInt(page, 10),
      parseInt(limit, 10),
    );
    return { success: true, data: result };
  }

  /**
   * Upload and validate a corpus file (no DB changes).
   * Returns validation result with preview.
   */
  @Post('validate')
  @Roles('ADMIN')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Validate a corpus file upload (no DB changes)' })
  @UseInterceptors(FileInterceptor('file', {
    limits: { fileSize: MAX_FILE_SIZE_BYTES },
  }))
  async validateUpload(
    @UploadedFile() file: any,
    @Body('allowUnknownColumns') allowUnknownColumns: string,
    @Body('sourceLabel') sourceLabel: string,
    @Req() req: Request,
  ) {
    if (!file) throw new BadRequestException('No file uploaded');
    const result = await this.paperCorpusService.validateUpload(
      file.buffer,
      file.mimetype,
      req.userId!,
      allowUnknownColumns === 'true',
      sourceLabel || 'Past Papers Archive',
    );
    // Return error report downloadable content as separate field
    const errorCsv = result.errors.length > 0
      ? await this.paperCorpusService.generateErrorReport(result.errors)
      : null;
    return { success: true, data: { ...result, parsedRows: undefined, errorReportCsv: errorCsv } };
  }

  /**
   * Commit a validated corpus upload (all-or-nothing).
   * Returns 400 if validation fails.
   */
  @Post('commit')
  @Roles('ADMIN')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Commit a validated corpus file (ADMIN only)' })
  @UseInterceptors(FileInterceptor('file', {
    limits: { fileSize: MAX_FILE_SIZE_BYTES },
  }))
  async commitUpload(
    @UploadedFile() file: any,
    @Body('name') name: string,
    @Body('licenceNote') licenceNote: string,
    @Body('sourceLabel') sourceLabel: string,
    @Body('withinFileStrategy') withinFileStrategy: string,
    @Body('crossCorpusStrategy') crossCorpusStrategy: string,
    @Body('allowUnknownColumns') allowUnknownColumns: string,
    @Req() req: Request,
  ) {
    if (!file) throw new BadRequestException('No file uploaded');
    if (!name?.trim()) throw new BadRequestException('corpus name is required');
    if (!sourceLabel?.trim()) throw new BadRequestException('sourceLabel is required');

    const dupeHandling = DuplicateHandlingSchema.parse({
      withinFileStrategy:  withinFileStrategy || 'SKIP',
      crossCorpusStrategy: crossCorpusStrategy || 'SKIP',
    });

    const result = await this.paperCorpusService.commitUpload(
      file.buffer,
      file.mimetype,
      name.trim(),
      licenceNote?.trim() || undefined,
      sourceLabel.trim(),
      req.userId!,
      dupeHandling,
      allowUnknownColumns === 'true',
    );
    return { success: true, data: result };
  }

  /**
   * Disable a corpus (requires step-up MFA TOTP in body).
   */
  @Patch(':corpusId/disable')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Disable a corpus (requires written reason + MFA)' })
  async disableCorpus(
    @Param('corpusId') corpusId: string,
    @Body() body: any,
    @Req() req: Request,
  ) {
    const input = DisablePaperCorpusSchema.parse(body);

    // Step-up MFA verification
    const user = await this.prisma.user.findUnique({ where: { id: req.userId! } });
    if (!user || !user.mfaEnabled) {
      throw new ForbiddenException('MFA must be enabled to disable a corpus');
    }
    const mfaValid = await this.authService.verifyStepUpTotp(req.userId!, input.totpToken);
    if (!mfaValid) {
      throw new ForbiddenException('Invalid MFA token for step-up verification');
    }

    const result = await this.paperCorpusService.disableCorpus(corpusId, input, req.userId!);
    return { success: true, data: result };
  }

  /**
   * Trigger index rebuild for a corpus (idempotent).
   */
  @Post(':corpusId/rebuild-index')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Trigger corpus index rebuild' })
  async rebuildIndex(
    @Param('corpusId') corpusId: string,
    @Req() req: Request,
  ) {
    this.paperCorpusService.triggerIndexBuild(corpusId).catch(() => {});
    return { success: true, data: { message: 'Index build triggered' } };
  }

  /**
   * Download CSV template file.
   */
  @Get('templates/csv')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Download CSV corpus template' })
  async downloadCsvTemplate(@Res() res: Response) {
    const templatePath = `${__dirname}/templates/corpus_template.csv`;
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="corpus_template.csv"');
    res.sendFile(templatePath);
  }

  /**
   * Download JSON example file.
   */
  @Get('templates/json')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Download JSON corpus example' })
  async downloadJsonExample(@Res() res: Response) {
    const examplePath = `${__dirname}/templates/corpus_example.json`;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="corpus_example.json"');
    res.sendFile(examplePath);
  }
}

