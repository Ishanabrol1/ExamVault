/**
 * Corpus file parser and validator.
 * Supports JSON and CSV (UTF-8, with or without BOM, RFC 4180).
 * Validation is all-or-nothing per file; no changes are made if any error exists.
 * Uses streaming for large files; max 25 MB, max 200,000 questions.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { parse as csvParse } from 'csv-parse';
import { z } from 'zod';
import { PaperCorpusQuestionRowSchema, PaperCorpusRowError } from '@examvault/shared';

export const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB
export const MAX_QUESTIONS = 200_000;

/** CSV column order (exactly as specified) */
const CSV_COLUMNS = [
  'source_exam', 'year', 'shift', 'paper_code', 'question_no',
  'language', 'question_type', 'stem',
  'option_1', 'option_2', 'option_3', 'option_4', 'option_5', 'option_6',
  'subject', 'topic', 'correct_answer',
] as const;

/** Guard against CSV formula injection in any exported value */
export function escapeCsvCell(value: string): string {
  if (!value) return '';
  const triggers = ['=', '+', '-', '@', '\t', '\r'];
  if (triggers.some(t => value.startsWith(t))) {
    return `\t${value}`;
  }
  return value;
}

/**
 * Extract embedded options (e.g. \nA. Option 1 \nB. Option 2) from raw question text.
 */
export function parseEmbeddedOptions(rawText: string): { stem: string; options: string[] } {
  if (!rawText) return { stem: '', options: [] };
  const optionRegex = /(?:\r?\n|\r)\s*(?:[A-Fa-f]|\([A-Fa-f]\))\s*[\.\)]\s*/;
  const parts = rawText.split(optionRegex);
  if (parts.length <= 1) {
    return { stem: rawText.trim(), options: [] };
  }
  const stem = parts[0].trim();
  const options: string[] = [];
  for (let i = 1; i < parts.length; i++) {
    const opt = parts[i].trim();
    if (opt) {
      options.push(opt);
    }
  }
  return { stem, options: options.slice(0, 6) };
}

export interface ParsedRow {
  rowIndex: number; // 1-based (header = 0)
  data: Record<string, any>;
}

export interface ValidationResult {
  valid: boolean;
  totalRows: number;
  validRows: number;
  errorCount: number;
  errors: PaperCorpusRowError[];
  withinFileDupeCount: number;
  crossCorpusDupeCount: number;
  withinFileDupes: { row: number; key: string }[];
  crossCorpusDupes: { row: number; existingCorpusId: string; key: string }[];
  preview: any[];
  parsedRows: any[]; // only populated on success for commit
}

/** Strip UTF-8 BOM */
function stripBom(buf: Buffer): string {
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return buf.slice(3).toString('utf8');
  }
  return buf.toString('utf8');
}

/** Build a deduplication key for a question row */
function buildDupeKey(row: any): string {
  const opts = Array.isArray(row.options) ? [...row.options].sort().join('|') : '';
  const normalizedStem = (row.stem || '').toLowerCase().replace(/\s+/g, ' ').trim();
  return crypto.createHash('sha256').update(
    `${normalizedStem}||${opts}`
  ).digest('hex');
}

/** Build the unique compound key for exact duplicate detection within a corpus */
function buildUniqueKey(row: any): string {
  return `${row.source_exam}::${row.year}::${row.question_no}::${row.language}`;
}

/**
 * Parse and validate a JSON corpus file.
 * Returns structured errors with row numbers.
 */
export async function parseAndValidateJson(
  content: string,
  existingHashes: Set<string> = new Set(),
  existingHashToCorpusId: Map<string, string> = new Map(),
  allowUnknownColumns = false,
): Promise<ValidationResult> {
  const errors: PaperCorpusRowError[] = [];
  const withinFileDupes: { row: number; key: string }[] = [];
  const crossCorpusDupes: { row: number; existingCorpusId: string; key: string }[] = [];
  const preview: any[] = [];
  const parsedRows: any[] = [];
  const seenKeys = new Map<string, number>(); // key -> first row
  const seenUniqueKeys = new Map<string, number>();

  let parsed: any;
  try {
    parsed = JSON.parse(content);
  } catch (e: any) {
    return {
      valid: false, totalRows: 0, validRows: 0, errorCount: 1,
      errors: [{ row: 0, field: 'file', message: `Invalid JSON: ${e.message}` }],
      withinFileDupeCount: 0, crossCorpusDupeCount: 0,
      withinFileDupes: [], crossCorpusDupes: [], preview: [], parsedRows: [],
    };
  }

  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.questions)) {
    return {
      valid: false, totalRows: 0, validRows: 0, errorCount: 1,
      errors: [{ row: 0, field: 'file', message: 'JSON must have { corpus: {...}, questions: [...] } structure' }],
      withinFileDupeCount: 0, crossCorpusDupeCount: 0,
      withinFileDupes: [], crossCorpusDupes: [], preview: [], parsedRows: [],
    };
  }

  const questions: any[] = parsed.questions;
  if (questions.length > MAX_QUESTIONS) {
    return {
      valid: false, totalRows: questions.length, validRows: 0, errorCount: 1,
      errors: [{ row: 0, field: 'file', message: `File contains ${questions.length} questions; maximum is ${MAX_QUESTIONS}` }],
      withinFileDupeCount: 0, crossCorpusDupeCount: 0,
      withinFileDupes: [], crossCorpusDupes: [], preview: [], parsedRows: [],
    };
  }

  let validRows = 0;
  for (let i = 0; i < questions.length; i++) {
    const rowIndex = i + 1;
    const raw = questions[i];

    // Check for unknown columns (if strict mode)
    if (!allowUnknownColumns) {
      const knownFields = new Set([
        'source_exam', 'year', 'shift', 'paper_code', 'question_no',
        'language', 'question_type', 'stem', 'options', 'subject', 'topic', 'correct_answer',
      ]);
      const unknownFields = Object.keys(raw).filter(k => !knownFields.has(k));
      if (unknownFields.length > 0) {
        errors.push({ row: rowIndex, field: unknownFields[0], message: `Unknown field: ${unknownFields.join(', ')}. Set allowUnknownColumns flag to ignore.` });
      }
    }

    const result = PaperCorpusQuestionRowSchema.safeParse(raw);
    if (!result.success) {
      for (const issue of result.error.issues) {
        errors.push({
          row: rowIndex,
          field: issue.path.join('.') || 'unknown',
          message: issue.message,
        });
      }
    } else {
      validRows++;
      const validated = result.data;

      // Within-file duplicate check (by dedup key)
      const dupeKey = buildDupeKey(validated);
      if (seenKeys.has(dupeKey)) {
        withinFileDupes.push({ row: rowIndex, key: dupeKey });
      } else {
        seenKeys.set(dupeKey, rowIndex);
      }

      // Within-file unique key check
      const uniqueKey = buildUniqueKey(validated);
      if (seenUniqueKeys.has(uniqueKey)) {
        withinFileDupes.push({ row: rowIndex, key: uniqueKey });
      } else {
        seenUniqueKeys.set(uniqueKey, rowIndex);
      }

      // Cross-corpus duplicate check
      if (existingHashes.has(dupeKey)) {
        const corpusId = existingHashToCorpusId.get(dupeKey) || '';
        crossCorpusDupes.push({ row: rowIndex, existingCorpusId: corpusId, key: dupeKey });
      }

      parsedRows.push(validated);
      if (preview.length < 20) preview.push(validated);
    }
  }

  return {
    valid: errors.length === 0,
    totalRows: questions.length,
    validRows,
    errorCount: errors.length,
    errors,
    withinFileDupeCount: withinFileDupes.length,
    crossCorpusDupeCount: crossCorpusDupes.length,
    withinFileDupes,
    crossCorpusDupes,
    preview,
    parsedRows,
  };
}

/**
 * Parse and validate a CSV corpus file (streaming).
 * Supports both canonical 17-column format AND flexible auto-adapting mode
 * for arbitrary question CSVs (e.g. 2-column datasets with embedded options).
 * Returns structured errors with row numbers.
 */
export async function parseAndValidateCsv(
  content: string | Buffer,
  existingHashes: Set<string> = new Set(),
  existingHashToCorpusId: Map<string, string> = new Map(),
  allowUnknownColumns = false,
  defaultSourceExam = 'Past Papers Archive',
  defaultYear = 2023,
): Promise<ValidationResult> {
  return new Promise((resolve) => {
    const errors: PaperCorpusRowError[] = [];
    const withinFileDupes: { row: number; key: string }[] = [];
    const crossCorpusDupes: { row: number; existingCorpusId: string; key: string }[] = [];
    const preview: any[] = [];
    const parsedRows: any[] = [];
    const seenKeys = new Map<string, number>();
    const seenUniqueKeys = new Map<string, number>();

    let rowIndex = 0;
    let totalRows = 0;
    let validRows = 0;
    let headersDetected = false;
    let isCanonicalMode = false;

    let stemCol: string | null = null;
    let subjectCol: string | null = null;
    let topicCol: string | null = null;
    let qNoCol: string | null = null;
    let sourceCol: string | null = null;
    let yearCol: string | null = null;
    let shiftCol: string | null = null;
    let codeCol: string | null = null;
    let langCol: string | null = null;
    let typeCol: string | null = null;
    let ansCol: string | null = null;
    let separateOptCols: string[] = [];

    const parser = csvParse({
      bom: true,
      columns: true,
      skip_empty_lines: true,
      relax_column_count: true,
      trim: true,
    });

    const detectMapping = (headers: string[]) => {
      if (headersDetected) return;
      headersDetected = true;

      const lowerMap = new Map<string, string>();
      for (const h of headers) {
        if (h && typeof h === 'string') {
          lowerMap.set(h.trim().toLowerCase(), h);
        }
      }

      // Check if file strictly has all canonical required columns
      const canonicalRequired = ['source_exam', 'year', 'question_no', 'language', 'question_type', 'stem'];
      const hasAllCanonical = canonicalRequired.every(c => lowerMap.has(c));

      if (hasAllCanonical) {
        isCanonicalMode = true;
        if (!allowUnknownColumns) {
          const knownSet = new Set([...CSV_COLUMNS]);
          const unknownCols = headers.filter(h => !knownSet.has(h.trim().toLowerCase() as any));
          if (unknownCols.length > 0) {
            errors.push({
              row: 0,
              field: unknownCols[0],
              message: `Unknown column(s): ${unknownCols.join(', ')}. Remove them or set allowUnknownColumns flag.`
            });
          }
        }
      } else {
        // Flexible Auto-Detection Mode
        isCanonicalMode = false;

        const STEM_ALIASES = ['stem', 'question', 'question_text', 'q_text', 'qtext', 'problem', 'eng', 'english', 'hindi', 'text', 'content', 'prompt', 'item', 'body', 'description'];
        const SUBJECT_ALIASES = ['subject', 'sub', 'subject_name', 'category', 'domain', 'course', 'stream'];
        const TOPIC_ALIASES = ['topic', 'subtopic', 'chapter', 'unit', 'section'];
        const QNO_ALIASES = ['question_no', 'q_no', 'qno', 'id', 'item_no', 'number', 'no', 'sno', 'sr_no'];
        const SOURCE_ALIASES = ['source_exam', 'source', 'exam', 'exam_name', 'test', 'paper'];
        const YEAR_ALIASES = ['year', 'exam_year', 'session'];
        const SHIFT_ALIASES = ['shift', 'slot', 'session', 'timing'];
        const CODE_ALIASES = ['paper_code', 'code', 'set', 'series'];
        const LANG_ALIASES = ['language', 'lang', 'medium'];
        const TYPE_ALIASES = ['question_type', 'qtype', 'type', 'item_type'];
        const ANS_ALIASES = ['correct_answer', 'answer', 'ans', 'correct', 'key'];

        const findCol = (aliases: string[]) => {
          for (const a of aliases) {
            if (lowerMap.has(a)) return lowerMap.get(a)!;
          }
          return null;
        };

        stemCol = findCol(STEM_ALIASES) || headers[0];
        subjectCol = findCol(SUBJECT_ALIASES);
        topicCol = findCol(TOPIC_ALIASES);
        qNoCol = findCol(QNO_ALIASES);
        sourceCol = findCol(SOURCE_ALIASES);
        yearCol = findCol(YEAR_ALIASES);
        shiftCol = findCol(SHIFT_ALIASES);
        codeCol = findCol(CODE_ALIASES);
        langCol = findCol(LANG_ALIASES);
        typeCol = findCol(TYPE_ALIASES);
        ansCol = findCol(ANS_ALIASES);

        // Check for separate option columns: option_1..option_6, opt1..opt6, a..f
        for (let i = 1; i <= 6; i++) {
          const optKey = findCol([`option_${i}`, `option${i}`, `opt_${i}`, `opt${i}`, `choice_${i}`, `choice${i}`]);
          if (optKey) separateOptCols.push(optKey);
        }
        if (separateOptCols.length === 0) {
          const letterCols = ['a', 'b', 'c', 'd', 'e', 'f'];
          const matchedLetters = letterCols.map(l => lowerMap.get(l)).filter(Boolean) as string[];
          if (matchedLetters.length >= 2) {
            separateOptCols = matchedLetters;
          }
        }
      }
    };

    parser.on('headers', (headers: string[]) => {
      detectMapping(headers);
    });

    parser.on('readable', function(this: any) {
      let record: any;
      while ((record = this.read()) !== null) {
        rowIndex++;
        totalRows++;

        if (!headersDetected) {
          detectMapping(Object.keys(record));
        }

        if (totalRows > MAX_QUESTIONS) {
          errors.push({ row: rowIndex, field: 'file', message: `File exceeds ${MAX_QUESTIONS} question limit at row ${rowIndex}` });
          continue;
        }

        let rowData: any;

        if (isCanonicalMode) {
          const options: string[] = [];
          for (let i = 1; i <= 6; i++) {
            const opt = record[`option_${i}`];
            if (opt && opt.trim()) options.push(opt.trim());
          }

          rowData = {
            source_exam:    record['source_exam'],
            year:           record['year'],
            shift:          record['shift'] || undefined,
            paper_code:     record['paper_code'] || undefined,
            question_no:    record['question_no'],
            language:       record['language'],
            question_type:  record['question_type'],
            stem:           record['stem'],
            options:        options.length > 0 ? options : undefined,
            subject:        record['subject'] || undefined,
            topic:          record['topic'] || undefined,
            correct_answer: record['correct_answer'] || undefined,
          };
        } else {
          // Flexible auto-adaptation mode
          const rawStem = (stemCol && record[stemCol]) || Object.values(record)[0] as string || '';
          if (!rawStem || !String(rawStem).trim()) {
            continue; // skip completely empty rows
          }

          let cleanStem = String(rawStem).trim();
          let opts: string[] = [];

          if (separateOptCols.length >= 2) {
            for (const col of separateOptCols) {
              const val = record[col];
              if (val && String(val).trim()) opts.push(String(val).trim());
            }
          } else {
            const parsed = parseEmbeddedOptions(cleanStem);
            cleanStem = parsed.stem;
            opts = parsed.options;
          }

          let qType: string;
          if (typeCol && record[typeCol]) {
            const specifiedType = String(record[typeCol]).trim().toUpperCase();
            if (['MCQ_SINGLE', 'MCQ_MULTI', 'INTEGER'].includes(specifiedType)) {
              qType = specifiedType;
            } else {
              qType = opts.length >= 2 ? 'MCQ_SINGLE' : 'INTEGER';
            }
          } else {
            qType = opts.length >= 2 ? 'MCQ_SINGLE' : 'INTEGER';
          }

          let parsedYear = defaultYear || 2023;
          if (yearCol && record[yearCol]) {
            const yr = parseInt(String(record[yearCol]).replace(/\D/g, ''), 10);
            if (!isNaN(yr) && yr >= 1950 && yr <= (new Date().getFullYear() + 1)) {
              parsedYear = yr;
            }
          }

          const rawLang = (langCol && record[langCol]) || (stemCol?.toLowerCase().includes('hindi') ? 'hi' : 'en');
          const cleanLang = String(rawLang).trim().toLowerCase().slice(0, 10) || 'en';

          rowData = {
            source_exam:    (sourceCol && record[sourceCol]) || defaultSourceExam,
            year:           parsedYear,
            shift:          (shiftCol && record[shiftCol]) || '',
            paper_code:     (codeCol && record[codeCol]) || '',
            question_no:    (qNoCol && record[qNoCol]) || `Q${rowIndex}`,
            language:       cleanLang,
            question_type:  qType,
            stem:           cleanStem,
            options:        opts.length >= 2 ? opts.slice(0, 6) : undefined,
            subject:        (subjectCol && record[subjectCol]) || '',
            topic:          (topicCol && record[topicCol]) || '',
            correct_answer: (ansCol && record[ansCol]) || '',
          };
        }

        const result = PaperCorpusQuestionRowSchema.safeParse(rowData);
        if (!result.success) {
          for (const issue of result.error.issues) {
            errors.push({
              row: rowIndex,
              field: issue.path.join('.') || 'unknown',
              message: issue.message,
            });
          }
        } else {
          validRows++;
          const validated = result.data;

          const dupeKey = buildDupeKey(validated);
          if (seenKeys.has(dupeKey)) {
            withinFileDupes.push({ row: rowIndex, key: dupeKey });
          } else {
            seenKeys.set(dupeKey, rowIndex);
          }

          const uniqueKey = buildUniqueKey(validated);
          if (seenUniqueKeys.has(uniqueKey)) {
            withinFileDupes.push({ row: rowIndex, key: uniqueKey });
          } else {
            seenUniqueKeys.set(uniqueKey, rowIndex);
          }

          if (existingHashes.has(dupeKey)) {
            const corpusId = existingHashToCorpusId.get(dupeKey) || '';
            crossCorpusDupes.push({ row: rowIndex, existingCorpusId: corpusId, key: dupeKey });
          }

          parsedRows.push(validated);
          if (preview.length < 20) preview.push(validated);
        }
      }
    });

    parser.on('error', (err: Error) => {
      errors.push({ row: rowIndex, field: 'file', message: `CSV parse error: ${err.message}` });
      resolve({
        valid: false, totalRows, validRows, errorCount: errors.length,
        errors, withinFileDupeCount: withinFileDupes.length,
        crossCorpusDupeCount: crossCorpusDupes.length,
        withinFileDupes, crossCorpusDupes, preview, parsedRows,
      });
    });

    parser.on('end', () => {
      resolve({
        valid: errors.length === 0,
        totalRows,
        validRows,
        errorCount: errors.length,
        errors,
        withinFileDupeCount: withinFileDupes.length,
        crossCorpusDupeCount: crossCorpusDupes.length,
        withinFileDupes,
        crossCorpusDupes,
        preview,
        parsedRows,
      });
    });

    parser.write(content);
    parser.end();
  });
}

/** Detect file type and dispatch to correct parser */
export async function parseCorpusFile(
  buffer: Buffer,
  mimeType: string,
  existingHashes: Set<string> = new Set(),
  existingHashToCorpusId: Map<string, string> = new Map(),
  allowUnknownColumns = false,
  defaultSourceExam = 'Past Papers Archive',
  defaultYear = 2023,
): Promise<ValidationResult & { detectedFormat: 'json' | 'csv' | 'unknown' }> {
  if (buffer.length > MAX_FILE_SIZE_BYTES) {
    return {
      valid: false, totalRows: 0, validRows: 0, errorCount: 1,
      errors: [{ row: 0, field: 'file', message: `File size ${(buffer.length / 1024 / 1024).toFixed(1)} MB exceeds 25 MB limit` }],
      withinFileDupeCount: 0, crossCorpusDupeCount: 0,
      withinFileDupes: [], crossCorpusDupes: [], preview: [], parsedRows: [],
      detectedFormat: 'unknown',
    };
  }

  const content = stripBom(buffer);
  const trimmed = content.trimStart();

  if (mimeType === 'application/json' || trimmed.startsWith('{')) {
    const result = await parseAndValidateJson(content, existingHashes, existingHashToCorpusId, allowUnknownColumns);
    return { ...result, detectedFormat: 'json' };
  }

  if (mimeType === 'text/csv' || mimeType === 'application/csv' || !trimmed.startsWith('{')) {
    const result = await parseAndValidateCsv(
      content,
      existingHashes,
      existingHashToCorpusId,
      allowUnknownColumns,
      defaultSourceExam,
      defaultYear,
    );
    return { ...result, detectedFormat: 'csv' };
  }

  return {
    valid: false, totalRows: 0, validRows: 0, errorCount: 1,
    errors: [{ row: 0, field: 'file', message: 'Unsupported file format. Upload JSON or CSV.' }],
    withinFileDupeCount: 0, crossCorpusDupeCount: 0,
    withinFileDupes: [], crossCorpusDupes: [], preview: [], parsedRows: [],
    detectedFormat: 'unknown',
  };
}

/** Compute hashes for a parsed corpus question (for deduplication) */
export function computeCorpusQuestionHashes(row: any): { stemHash: string; combinedHash: string; maskedHash: string } {
  const normalizeText = (text: string): string =>
    text.toLowerCase().replace(/\s+/g, ' ').trim();

  const maskNumbers = (text: string): string =>
    text.replace(/\b\d+(\.\d+)?\b/g, '<NUM>');

  const normStem = normalizeText(row.stem || '');
  const normOptions = Array.isArray(row.options) ? row.options.map(normalizeText).sort().join('|') : '';
  const normCombined = `${normStem}||${normOptions}`;
  const maskedCombined = maskNumbers(normCombined);

  return {
    stemHash:     crypto.createHash('sha256').update(normStem).digest('hex'),
    combinedHash: crypto.createHash('sha256').update(normCombined).digest('hex'),
    maskedHash:   crypto.createHash('sha256').update(maskedCombined).digest('hex'),
  };
}

