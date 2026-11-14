# ExamVault Previous-Year Question Corpus: Empirical Evaluation Report

Deterministic retrieval and scoring evaluation over a synthetic corpus of **5,000 questions** in English and Hindi.

> **System Invariants:** No hosted AI or external LLM API received question text. Matching is deterministic retrieval via SHA-256 exact hash, character and word MinHash/LSH, and TF-IDF cosine scoring over normalized tokens.

## 1. Latency Benchmark across Corpus Scales

| Corpus Size | P50 (Median) | P95 Latency | P99 Latency | Target (< 1000 ms) | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **1,000 questions** | 27.5 ms | 60.6 ms | 100.1 ms | < 1,000 ms | ✅ MET |
| **2,500 questions** | 58.0 ms | 84.4 ms | 128.0 ms | < 1,000 ms | ✅ MET |
| **5,000 questions** | 106.4 ms | 214.3 ms | 528.3 ms | < 1,000 ms | ✅ MET |

## 2. Accuracy & Confusion Matrix by Threshold

| Threshold | Precision | Recall | F1 Score | TP | FP | TN | FN |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **EXACT (1.00)** | 1.000 | 0.447 | **0.618** | 201 | 0 | 100 | 249 |
| **HIGH (>= 0.85)** | 1.000 | 0.756 | **0.861** | 340 | 0 | 100 | 110 |
| **MEDIUM (>= 0.60)** | 1.000 | 0.804 | **0.892** | 362 | 0 | 100 | 88 |

## 3. Plagiarism & Variation Category Breakdown (at Medium >= 0.60)

| Mutation Category | Tested Pairs | Detected (Exact) | Detected (High >= 0.85) | Detected (Med >= 0.60) | Recall (Med+) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **EXACT** | 75 | 75 | 75 | 75 | **100.0%** |
| **FORMATTING_WHITESPACE** | 75 | 75 | 75 | 75 | **100.0%** |
| **NUMBERS_CHANGED** | 75 | 0 | 55 | 75 | **100.0%** |
| **OPTIONS_REORDERED** | 75 | 0 | 75 | 75 | **100.0%** |
| **LIGHT_EDITS** | 60 | 51 | 60 | 60 | **100.0%** |
| **PARAPHRASE** | 50 | 0 | 0 | 0 | **0.0%** |
| **HINDI_ENGLISH_TRANSLATION** | 40 | 0 | 0 | 2 | **5.0%** |
| **UNRELATED_CONTROL (Negative Controls)** | 100 | 0 | 0 | 0 | Specificity: **100.0%** |

## 4. Key Findings & Architectural Observations

1. **Exact & Formatting Invariance**: SHA-256 and Unicode NFKC + LaTeX normalization correctly achieve 100% recall on exact copies and whitespace/LaTeX tweaks.
2. **Number-Masked Detection**: Number-masked tokenization identifies questions with modified parameters (`NUMBERS_CHANGED`) with > 94% recall, triggering the configured admin policy.
3. **Option Reordering**: Multiset set-equality check detects scrambled answer options with 100% precision.
4. **Cross-Language Matching Limitation**: Pure deterministic lexical tokenization cannot bridge Hindi-English translations without shared vocabulary. As required by specifications, **translation matching requires the optional multilingual embedding model**, which is feature-flagged off by default.
5. **Sub-Second Performance**: With inverted shingle indexes and TF-IDF candidate narrowing, p95 latency remains well under 1,000 ms on 5,000 corpus questions.
