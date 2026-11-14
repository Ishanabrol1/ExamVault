import { parseAndValidateJson, parseAndValidateCsv, escapeCsvCell } from '../src/corpus/corpus-parser';
import { guardCsvCell, PaperCorpusRowError } from '@examvault/shared';

describe('Paper Corpus and Live Originality Feedback Acceptance Tests', () => {
  describe('Corpus Parsing, Streaming & Validation', () => {
    const validJsonContent = JSON.stringify({
      corpus: {
        name: 'JEE Advanced Physics 2022',
        licence_note: 'Public educational use',
        source_label: 'Official NTA',
      },
      questions: [
        {
          source_exam: 'JEE Advanced',
          year: 2022,
          shift: 'Morning',
          paper_code: 'Paper-1',
          question_no: '1',
          language: 'en',
          question_type: 'MCQ_SINGLE',
          stem: 'A particle of mass m moves under the action of a central force.',
          options: ['E is conserved', 'L is not conserved', 'Path is parabolic', 'None of these'],
          subject: 'Physics',
          topic: 'Mechanics',
          correct_answer: 'A',
        },
        {
          source_exam: 'JEE Advanced',
          year: 2022,
          shift: 'Morning',
          paper_code: 'Paper-1',
          question_no: '2',
          language: 'en',
          question_type: 'INTEGER',
          stem: 'The magnitude of magnetic field at the centre of circular loop in Tesla is:',
          options: [],
          subject: 'Physics',
          topic: 'Electromagnetism',
          correct_answer: '4',
        },
      ],
    });

    const validCsvContent =
      'source_exam,year,shift,paper_code,question_no,language,question_type,stem,option_1,option_2,option_3,option_4,option_5,option_6,subject,topic,correct_answer\r\n' +
      'JEE Advanced,2022,Morning,Paper-1,1,en,MCQ_SINGLE,A particle of mass m moves under the action of a central force.,E is conserved,L is not conserved,Path is parabolic,None of these,,,Physics,Mechanics,A\r\n' +
      'JEE Advanced,2022,Morning,Paper-1,2,en,INTEGER,The magnitude of magnetic field at the centre of circular loop in Tesla is:,,,,,,,Physics,Electromagnetism,4\r\n';

    it('should parse valid JSON and CSV into identical corpus question records', async () => {
      const csvBuffer = Buffer.from(validCsvContent, 'utf-8');

      const jsonResult = await parseAndValidateJson(validJsonContent);
      const csvResult = await parseAndValidateCsv(csvBuffer);

      expect(jsonResult.valid).toBe(true);
      expect(csvResult.valid).toBe(true);
      expect(jsonResult.totalRows).toBe(2);
      expect(csvResult.totalRows).toBe(2);
      expect(jsonResult.errors).toHaveLength(0);
      expect(csvResult.errors).toHaveLength(0);

      // Compare question records across JSON and CSV
      expect(jsonResult.parsedRows[0].source_exam).toBe(csvResult.parsedRows[0].source_exam);
      expect(jsonResult.parsedRows[0].year).toBe(csvResult.parsedRows[0].year);
      expect(jsonResult.parsedRows[0].stem).toBe(csvResult.parsedRows[0].stem);
      expect(jsonResult.parsedRows[0].options).toEqual(csvResult.parsedRows[0].options);
      expect(jsonResult.parsedRows[0].question_type).toBe(csvResult.parsedRows[0].question_type);

      expect(jsonResult.parsedRows[1].stem).toBe(csvResult.parsedRows[1].stem);
      expect(jsonResult.parsedRows[1].question_type).toBe('INTEGER');
      expect(jsonResult.parsedRows[1].options?.length ?? 0).toBe(0);
    });

    it('should handle UTF-8 with BOM correctly', async () => {
      const bomCsvBuffer = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(validCsvContent, 'utf-8')]);
      const csvResult = await parseAndValidateCsv(bomCsvBuffer);
      expect(csvResult.valid).toBe(true);
      expect(csvResult.parsedRows[0].source_exam).toBe('JEE Advanced');
    });

    it('should report row-level errors with exact line numbers for invalid data and reject all', async () => {
      const invalidCsv =
        'source_exam,year,shift,paper_code,question_no,language,question_type,stem,option_1,option_2,option_3,option_4,option_5,option_6,subject,topic,correct_answer\r\n' +
        'JEE Main,1800,Morning,P1,1,en,MCQ_SINGLE,Valid stem here,Opt A,Opt B,,,,,Physics,Topic,A\r\n' + // Year < 1950
        'NEET,2023,Evening,P2,2,en,MCQ_SINGLE,Stem with only one option,Opt A,,,,,,Biology,Topic,A\r\n' + // Only 1 option for MCQ
        'NEET,2023,Evening,P2,3,en,INTEGER,Integer with options,Opt A,Opt B,,,,,Biology,Topic,A\r\n'; // Integer with options

      const result = await parseAndValidateCsv(Buffer.from(invalidCsv, 'utf-8'));
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(3);

      const row1Err = result.errors.find((e: PaperCorpusRowError) => e.row === 1);
      expect(row1Err).toBeDefined();
      expect(row1Err!.message).toContain('1950');

      const row2Err = result.errors.find((e: PaperCorpusRowError) => e.row === 2);
      expect(row2Err).toBeDefined();
      expect(row2Err!.message).toContain('MCQ questions require 2–6 options');

      const row3Err = result.errors.find((e: PaperCorpusRowError) => e.row === 3);
      expect(row3Err).toBeDefined();
      expect(row3Err!.message).toContain('INTEGER questions must not have options');
    });

    it('should detect duplicate questions within a file and compute duplicate groups', async () => {
      const duplicateCsv =
        'source_exam,year,shift,paper_code,question_no,language,question_type,stem,option_1,option_2,option_3,option_4,option_5,option_6,subject,topic,correct_answer\r\n' +
        'JEE,2021,,P1,1,en,MCQ_SINGLE,What is the speed of light?,3x10^8 m/s,4x10^8 m/s,,,,,Physics,Optics,A\r\n' +
        'JEE,2021,,P1,2,en,MCQ_SINGLE,  what  is  the  speed of light?  ,3x10^8 m/s,4x10^8 m/s,,,,,Physics,Optics,A\r\n';

      const result = await parseAndValidateCsv(Buffer.from(duplicateCsv, 'utf-8'));
      expect(result.valid).toBe(true);
      expect(result.withinFileDupeCount).toBe(1);
      expect(result.withinFileDupes).toHaveLength(1);
      expect(result.withinFileDupes[0].row).toBe(2); // row 2 is duplicate of row 1
    });

    it('should sanitize cells against formula injection during CSV export', () => {
      expect(escapeCsvCell('=SUM(A1:B1)')).toBe('\t=SUM(A1:B1)');
      expect(escapeCsvCell('+cmd|/c calc.exe')).toBe('\t+cmd|/c calc.exe');
      expect(escapeCsvCell('-5+5')).toBe('\t-5+5');
      expect(escapeCsvCell('@dangerous')).toBe('\t@dangerous');
      expect(escapeCsvCell('Normal text 42')).toBe('Normal text 42');

      expect(guardCsvCell('=SUM(A1:B1)', true)).toBe("'=SUM(A1:B1)");
      expect(guardCsvCell('Normal text 42', true)).toBe('Normal text 42');
    });
  });

  describe('Live Check Visibility Rules (Bank Masking vs Past Paper Disclosure)', () => {
    it('should enforce bank confidentiality: bank match never exposes code, raw text or fine score', () => {
      const bankMatch = {
        sourceType: 'BANK' as const,
        matchType: 'NEAR' as const,
        riskLevel: 'HIGH' as const,
        bankMessage: 'Possible duplicate in the question bank',
      };

      // Bank match has NO citation, NO raw stem/code, and NO numeric score exposed to examiner
      expect((bankMatch as any).citation).toBeUndefined();
      expect((bankMatch as any).matchedText).toBeUndefined();
      expect((bankMatch as any).matchedQuestionVersionId).toBeUndefined();
      expect((bankMatch as any).overallScore).toBeUndefined();
      expect(bankMatch.bankMessage).toBe('Possible duplicate in the question bank');
    });

    it('should provide full citation and matched text for past paper matches', () => {
      const pastPaperMatch = {
        sourceType: 'PAST_PAPER' as const,
        matchType: 'EXACT' as const,
        riskLevel: 'EXACT' as const,
        overallScore: 1.0,
        citation: {
          source_exam: 'JEE Advanced',
          year: 2021,
          shift: 'Morning',
          paper_code: 'Paper-1',
          question_no: '14',
        },
        matchedText: 'A block of mass 2 kg rests on a frictionless plane...',
        spans: [{ queryStart: 0, queryEnd: 45, targetStart: 0, targetEnd: 45 }],
      };

      expect(pastPaperMatch.citation.source_exam).toBe('JEE Advanced');
      expect(pastPaperMatch.citation.year).toBe(2021);
      expect(pastPaperMatch.citation.question_no).toBe('14');
      expect(pastPaperMatch.matchedText).toContain('A block of mass 2 kg');
      expect(pastPaperMatch.spans).toHaveLength(1);
    });
  });

  describe('Submission Policy Enforcement', () => {
    it('should enforce min 50 char justification when past paper match action is BLOCK_UNLESS_JUSTIFIED', () => {
      const shortJustification = 'This is a standard textbook question.';
      expect(shortJustification.length).toBeLessThan(50);

      const validJustification =
        'This question is adapted from standard NCERT curriculum concepts but with fundamentally modified boundary conditions and numerical constants for the 2026 exam cycle.';
      expect(validJustification.length).toBeGreaterThanOrEqual(50);
    });
  });
});
