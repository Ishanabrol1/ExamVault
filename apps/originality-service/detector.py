"""
Extended OriginalityEngine with two separate indexes:
  - BankIndex: memory-only (bank questions, existing Step 2 behavior)
  - CorpusIndex: disk-persisted (past-paper corpus, public data)

New match types: EXACT | NEAR | NUMBERS_CHANGED | OPTIONS_MATCH | SEMANTIC
Citations for PAST_PAPER matches include: source_exam, year, shift, paper_code, question_no
"""
import hashlib
import os
import pickle
import threading
from typing import Dict, List, Optional, Tuple, Any
from datasketch import MinHash, MinHashLSH
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity
import numpy as np
from normalizer import Normalizer

# Persistence path for public corpus index (safe to store on disk — public data)
CORPUS_INDEX_PATH = os.getenv('CORPUS_INDEX_PATH', '/tmp/examvault_corpus_index.pkl')

MATCH_TYPE_EXACT          = 'EXACT'
MATCH_TYPE_NEAR           = 'NEAR'
MATCH_TYPE_NUMBERS_CHANGED = 'NUMBERS_CHANGED'
MATCH_TYPE_OPTIONS_MATCH  = 'OPTIONS_MATCH'
MATCH_TYPE_SEMANTIC       = 'SEMANTIC'


class IndexedDocument:
    def __init__(
        self,
        doc_id: str,
        source_type: str,          # 'BANK', 'PAST_PAPER', 'PUBLIC'
        source_reference: str,     # e.g. Human ID or "JEE Advanced::2023::1::en"
        version_no: int,
        stem: str,
        options: List[str],
        parent_version_id: Optional[str] = None,
        author_id: Optional[str] = None,
        citation: Optional[Dict[str, Any]] = None,  # For PAST_PAPER
    ):
        self.doc_id = doc_id
        self.source_type = source_type
        self.source_reference = source_reference
        self.version_no = version_no
        self.parent_version_id = parent_version_id
        self.author_id = author_id
        self.citation = citation  # {source_exam, year, shift, paper_code, question_no}

        # Plaintexts stored in-memory (BANK) or on disk (PAST_PAPER — public data)
        self.raw_stem = stem
        self.raw_options = options

        # Normalization
        self.norm_stem = Normalizer.normalize_text(stem)
        self.norm_options = [Normalizer.normalize_text(opt) for opt in options]
        self.norm_combined = self.norm_stem + ' ' + ' '.join(self.norm_options)

        # Number-masked normalization
        self.masked_stem = Normalizer.normalize_text(stem, mask_numbers=True)
        self.masked_combined = Normalizer.normalize_text(self.norm_combined, mask_numbers=True)

        # Exact hashes
        self.exact_hash        = hashlib.sha256(self.norm_combined.encode('utf-8')).hexdigest()
        self.stem_hash         = hashlib.sha256(self.norm_stem.encode('utf-8')).hexdigest()
        self.masked_hash       = hashlib.sha256(self.masked_combined.encode('utf-8')).hexdigest()
        self.masked_stem_hash  = hashlib.sha256(self.masked_stem.encode('utf-8')).hexdigest()

        # MinHash for near-duplicate detection
        self.minhash      = self._compute_minhash(self.norm_combined)
        self.stem_minhash = self._compute_minhash(self.norm_stem)

    @staticmethod
    def _compute_minhash(text: str, num_perm: int = 128) -> MinHash:
        m = MinHash(num_perm=num_perm)
        word_shingles = Normalizer.get_shingles(text, k=3)
        char_shingles = Normalizer.get_char_shingles(text, k=5)
        for s in word_shingles + char_shingles:
            m.update(s.encode('utf-8'))
        return m


class BankIndex:
    """
    In-memory-only index for question bank documents.
    NEVER written to disk. NEVER reveals content to external callers.
    """
    def __init__(self, lsh_threshold: float = 0.5):
        self.lsh_threshold = lsh_threshold
        self.documents: Dict[str, IndexedDocument] = {}
        self.inverted_tokens: Dict[str, Set[str]] = {}
        self.lsh = MinHashLSH(threshold=lsh_threshold, num_perm=128)
        self.tfidf_vectorizer: Optional[TfidfVectorizer] = None
        self.tfidf_matrix: Optional[Any] = None
        self.doc_id_list: List[str] = []
        self._dirty_tfidf = False
        self._lock = threading.Lock()

    def add_document(self, doc: IndexedDocument):
        with self._lock:
            if doc.doc_id in self.documents:
                self._remove_internal(doc.doc_id)
            self.documents[doc.doc_id] = doc
            for w in doc.norm_stem.split():
                if len(w) >= 3:
                    self.inverted_tokens.setdefault(w, set()).add(doc.doc_id)
            try:
                self.lsh.insert(doc.doc_id, doc.minhash)
            except ValueError:
                pass
            self._dirty_tfidf = True

    def remove_document(self, doc_id: str):
        with self._lock:
            self._remove_internal(doc_id)

    def _remove_internal(self, doc_id: str):
        if doc_id in self.documents:
            try:
                self.lsh.remove(doc_id)
            except (KeyError, ValueError):
                pass
            del self.documents[doc_id]
            self._dirty_tfidf = True

    def clear(self):
        with self._lock:
            self.documents.clear()
            self.lsh = MinHashLSH(threshold=self.lsh_threshold, num_perm=128)
            self.tfidf_vectorizer = None
            self.tfidf_matrix = None
            self.doc_id_list = []
            self._dirty_tfidf = False

    def rebuild_tfidf(self):
        with self._lock:
            if not self._dirty_tfidf and self.tfidf_matrix is not None:
                return
            self.doc_id_list = list(self.documents.keys())
            if not self.doc_id_list:
                self.tfidf_vectorizer = None
                self.tfidf_matrix = None
                self._dirty_tfidf = False
                return
            corpus_texts = [self.documents[did].norm_combined for did in self.doc_id_list]
            self.tfidf_vectorizer = TfidfVectorizer(ngram_range=(1, 2), sublinear_tf=True, min_df=1)
            self.tfidf_matrix = self.tfidf_vectorizer.fit_transform(corpus_texts)
            self._dirty_tfidf = False
            self._save_to_disk()


class CorpusIndex:
    """
    Disk-persisted index for public past-paper corpus documents.
    Safe to store on disk (public examination material).
    """
    def __init__(self, lsh_threshold: float = 0.5, persist_path: str = CORPUS_INDEX_PATH):
        self.lsh_threshold = lsh_threshold
        self.persist_path = persist_path
        self.documents: Dict[str, IndexedDocument] = {}  # corpusId -> {docId -> doc}
        self.corpus_docs: Dict[str, Dict[str, IndexedDocument]] = {}  # corpusId -> {docId -> doc}
        self.inverted_tokens: Dict[str, Set[str]] = {}
        self.lsh = MinHashLSH(threshold=lsh_threshold, num_perm=128)
        self.tfidf_vectorizer: Optional[TfidfVectorizer] = None
        self.tfidf_matrix: Optional[Any] = None
        self.doc_id_list: List[str] = []
        self._dirty_tfidf = False
        self._lock = threading.Lock()
        self._load_from_disk()

    def _load_from_disk(self):
        """Load persisted corpus index from disk on startup."""
        if os.path.exists(self.persist_path):
            try:
                with open(self.persist_path, 'rb') as f:
                    state = pickle.load(f)
                self.documents = state.get('documents', {})
                self.corpus_docs = state.get('corpus_docs', {})
                # Rebuild LSH and token index from loaded documents
                self.lsh = MinHashLSH(threshold=self.lsh_threshold, num_perm=128)
                self.inverted_tokens = {}
                for doc_id, doc in self.documents.items():
                    try:
                        self.lsh.insert(doc_id, doc.minhash)
                    except ValueError:
                        pass
                    for w in doc.norm_stem.split():
                        if len(w) >= 3:
                            self.inverted_tokens.setdefault(w, set()).add(doc_id)
                self._dirty_tfidf = True
            except Exception as e:
                # Corrupt file: start fresh
                self.documents = {}
                self.corpus_docs = {}
                self.inverted_tokens = {}
                self.lsh = MinHashLSH(threshold=self.lsh_threshold, num_perm=128)

    def _save_to_disk(self):
        """Persist corpus index to disk (atomic write)."""
        try:
            tmp_path = self.persist_path + '.tmp'
            with open(tmp_path, 'wb') as f:
                pickle.dump({
                    'documents':   self.documents,
                    'corpus_docs': self.corpus_docs,
                }, f)
            os.replace(tmp_path, self.persist_path)
        except Exception:
            pass  # Non-fatal; will rebuild from DB on next start

    def add_corpus_batch(self, corpus_id: str, docs: List[IndexedDocument]):
        """Add a batch of documents for a corpus."""
        with self._lock:
            if corpus_id not in self.corpus_docs:
                self.corpus_docs[corpus_id] = {}
            for doc in docs:
                self.documents[doc.doc_id] = doc
                self.corpus_docs[corpus_id][doc.doc_id] = doc
                try:
                    self.lsh.insert(doc.doc_id, doc.minhash)
                except ValueError:
                    pass
                for w in doc.norm_stem.split():
                    if len(w) >= 3:
                        self.inverted_tokens.setdefault(w, set()).add(doc.doc_id)
            self._dirty_tfidf = True

    def clear_corpus(self, corpus_id: str):
        """Remove all documents for a corpus from the live index."""
        with self._lock:
            if corpus_id not in self.corpus_docs:
                return
            for doc_id in list(self.corpus_docs[corpus_id].keys()):
                try:
                    self.lsh.remove(doc_id)
                except (KeyError, ValueError):
                    pass
                self.documents.pop(doc_id, None)
            del self.corpus_docs[corpus_id]
            self.inverted_tokens = {}
            for doc_id, doc in self.documents.items():
                for w in doc.norm_stem.split():
                    if len(w) >= 3:
                        self.inverted_tokens.setdefault(w, set()).add(doc_id)
            self._dirty_tfidf = True

    def remove_corpus(self, corpus_id: str):
        """Remove all documents for a corpus from the live index."""
        with self._lock:
            if corpus_id not in self.corpus_docs:
                return
            for doc_id in list(self.corpus_docs[corpus_id].keys()):
                try:
                    self.lsh.remove(doc_id)
                except (KeyError, ValueError):
                    pass
                self.documents.pop(doc_id, None)
            del self.corpus_docs[corpus_id]
            self._dirty_tfidf = True
            self._save_to_disk()

    def clear(self):
        with self._lock:
            self.documents.clear()
            self.corpus_docs.clear()
            self.lsh = MinHashLSH(threshold=self.lsh_threshold, num_perm=128)
            self.tfidf_vectorizer = None
            self.tfidf_matrix = None
            self.doc_id_list = []
            self._dirty_tfidf = False
            self._save_to_disk()

    def rebuild_tfidf(self):
        with self._lock:
            if not self._dirty_tfidf and self.tfidf_matrix is not None:
                return
            self.doc_id_list = list(self.documents.keys())
            if not self.doc_id_list:
                self.tfidf_vectorizer = None
                self.tfidf_matrix = None
                self._dirty_tfidf = False
                return
            corpus_texts = [self.documents[did].norm_combined for did in self.doc_id_list]
            self.tfidf_vectorizer = TfidfVectorizer(ngram_range=(1, 2), sublinear_tf=True, min_df=1)
            self.tfidf_matrix = self.tfidf_vectorizer.fit_transform(corpus_texts)
            self._dirty_tfidf = False
            self._save_to_disk()


class OriginalityEngine:
    """
    Unified engine with separate bank (memory) and corpus (disk) indexes.
    Runs: normalize -> exact hash -> MinHash/LSH candidates -> TF-IDF cosine -> combined score.
    """
    def __init__(self, lsh_threshold: float = 0.5):
        self.lsh_threshold = lsh_threshold
        self.bank = BankIndex(lsh_threshold)
        self.corpus = CorpusIndex(lsh_threshold)

        # Legacy compatibility: single documents dict points to bank
        @property
        def documents(self):
            return self.bank.documents

    @property
    def documents(self) -> Dict[str, IndexedDocument]:
        """Legacy compatibility — returns bank documents."""
        return self.bank.documents

    def add_document(self, doc: IndexedDocument):
        """Add a document to the bank index (legacy API)."""
        self.bank.add_document(doc)

    def remove_document(self, doc_id: str):
        self.bank.remove_document(doc_id)

    def clear(self):
        self.bank.clear()

    def rebuild_tfidf(self):
        self.bank.rebuild_tfidf()
        self.corpus.rebuild_tfidf()

    def check_question(
        self,
        question_id: str,
        version_no: int,
        stem: str,
        options: List[str],
        parent_version_id: Optional[str] = None,
        author_id: Optional[str] = None,
        exact_match_threshold: float = 1.0,
        high_threshold: float = 0.85,
        medium_threshold: float = 0.60,
        treat_number_changed_as_duplicate: bool = True,
    ) -> Dict[str, Any]:
        """
        Full bank + corpus check for a submitted question version.
        Returns riskLevel, highestScore, matches, totalMatches.
        """
        self.bank.rebuild_tfidf()
        self.corpus.rebuild_tfidf()

        # Build query representations
        norm_stem     = Normalizer.normalize_text(stem)
        norm_options  = [Normalizer.normalize_text(opt) for opt in options]
        norm_combined = norm_stem + ' ' + ' '.join(norm_options)
        masked_stem   = Normalizer.normalize_text(norm_stem, mask_numbers=True)
        masked_combined = Normalizer.normalize_text(norm_combined, mask_numbers=True)

        query_exact_hash   = hashlib.sha256(norm_combined.encode()).hexdigest()
        query_masked_hash  = hashlib.sha256(masked_combined.encode()).hexdigest()
        query_stem_hash    = hashlib.sha256(norm_stem.encode()).hexdigest()
        query_masked_stem_hash = hashlib.sha256(masked_stem.encode()).hexdigest()
        query_minhash      = IndexedDocument._compute_minhash(norm_combined)
        query_stem_minhash = IndexedDocument._compute_minhash(norm_stem)

        # TF-IDF vectors for bank and corpus
        bank_tfidf_sims  = self._compute_tfidf_sims(norm_combined, self.bank)
        corpus_tfidf_sims = self._compute_tfidf_sims(norm_combined, self.corpus)

        matches = []
        highest_score = 0.0

        # Check both indexes
        query_words = [w for w in norm_stem.split() if len(w) >= 3]
        for index, tfidf_sims in [(self.bank, bank_tfidf_sims), (self.corpus, corpus_tfidf_sims)]:
            candidate_ids = set()
            for w in query_words:
                if hasattr(index, 'inverted_tokens') and w in index.inverted_tokens:
                    m = index.inverted_tokens[w]
                    if len(m) <= 500:
                        candidate_ids.update(m)
            try:
                lsh_hits = index.lsh.query(query_minhash)
                candidate_ids.update(lsh_hits[:50])
            except Exception:
                pass
            if tfidf_sims:
                for did in tfidf_sims:
                    candidate_ids.add(did)
            if not candidate_ids and len(index.documents) <= 200:
                candidate_ids = set(index.documents.keys())

            for doc_id in candidate_ids:
                doc = index.documents.get(doc_id)
                if not doc:
                    continue
                # Exclude self-comparison
                if doc.doc_id == question_id or doc.doc_id == f'{question_id}:{version_no}':
                    continue
                if parent_version_id and (doc.doc_id == parent_version_id or doc.doc_id.startswith(parent_version_id)):
                    continue

                match = self._score_pair(
                    query_exact_hash, query_masked_hash, query_stem_hash,
                    query_minhash, query_stem_minhash,
                    norm_options, norm_combined,
                    doc, tfidf_sims,
                    treat_number_changed_as_duplicate,
                    query_masked_stem_hash,
                    norm_query_stem=norm_stem,
                )
                if match is None:
                    continue

                overall_score = match['overallScore']
                if overall_score >= medium_threshold or match['exactHashMatch']:
                    highest_score = max(highest_score, overall_score)
                    # Determine match type
                    match_type = self._determine_match_type(match, doc, treat_number_changed_as_duplicate)
                    match['matchType'] = match_type
                    # Citation for PAST_PAPER
                    if doc.source_type == 'PAST_PAPER' and doc.citation:
                        match['citation'] = doc.citation
                        match['matchedText'] = doc.raw_stem[:500] + ('...' if len(doc.raw_stem) > 500 else '')
                    matches.append(match)

        matches.sort(key=lambda m: m['overallScore'], reverse=True)

        # Risk level
        if highest_score >= exact_match_threshold:
            risk_level = 'EXACT'
        elif highest_score >= high_threshold:
            risk_level = 'HIGH'
        elif highest_score >= medium_threshold:
            risk_level = 'MEDIUM'
        elif highest_score > 0.25:
            risk_level = 'LOW'
        else:
            risk_level = 'NONE'

        return {
            'riskLevel': risk_level,
            'highestScore': round(highest_score, 4),
            'matches': matches,
            'totalMatches': len(matches),
        }

    def check_draft(
        self,
        stem: str,
        options: List[str],
        question_type: str,
        language: str = 'en',
        subject: str = '',
        topic: str = '',
        exact_match_threshold: float = 1.0,
        high_threshold: float = 0.85,
        medium_threshold: float = 0.60,
        treat_number_changed_as_duplicate: bool = True,
        max_results: int = 5,
    ) -> Dict[str, Any]:
        """
        Live draft check — returns top-5 matches with visibility rules:
        - PAST_PAPER: full citation, matched text, spans
        - BANK: only generic message, risk level, match type (no code/text/score)
        Draft is NEVER stored, logged (content), or added to any index.
        """
        norm_stem     = Normalizer.normalize_text(stem)
        norm_options  = [Normalizer.normalize_text(opt) for opt in options]
        norm_combined = norm_stem + ' ' + ' '.join(norm_options)
        masked_stem   = Normalizer.normalize_text(norm_stem, mask_numbers=True)
        masked_combined = Normalizer.normalize_text(norm_combined, mask_numbers=True)

        query_exact_hash   = hashlib.sha256(norm_combined.encode()).hexdigest()
        query_masked_hash  = hashlib.sha256(masked_combined.encode()).hexdigest()
        query_stem_hash    = hashlib.sha256(norm_stem.encode()).hexdigest()
        query_masked_stem_hash = hashlib.sha256(masked_stem.encode()).hexdigest()
        query_minhash      = IndexedDocument._compute_minhash(norm_combined)
        query_stem_minhash = IndexedDocument._compute_minhash(norm_stem)

        bank_tfidf_sims   = self._compute_tfidf_sims(norm_combined, self.bank)
        corpus_tfidf_sims = self._compute_tfidf_sims(norm_combined, self.corpus)

        raw_matches = []
        query_words = [w for w in norm_stem.split() if len(w) >= 3]

        for index, tfidf_sims in [(self.bank, bank_tfidf_sims), (self.corpus, corpus_tfidf_sims)]:
            candidate_ids = set()

            # 1. Inverted tokens for query words (instant retrieval in < 1ms)
            for w in query_words:
                if hasattr(index, 'inverted_tokens') and w in index.inverted_tokens:
                    m = index.inverted_tokens[w]
                    if len(m) <= 500:
                        candidate_ids.update(m)

            # 2. MinHash LSH queries (< 5ms)
            try:
                lsh_hits = index.lsh.query(query_minhash)
                candidate_ids.update(lsh_hits[:50])
            except Exception:
                pass

            # 3. TF-IDF non-zero candidates
            if tfidf_sims:
                for did in tfidf_sims:
                    candidate_ids.add(did)

            # Fallback for small index
            if not candidate_ids and len(index.documents) <= 200:
                candidate_ids = set(index.documents.keys())

            for doc_id in candidate_ids:
                doc = index.documents.get(doc_id)
                if not doc:
                    continue
                match = self._score_pair(
                    query_exact_hash, query_masked_hash, query_stem_hash,
                    query_minhash, query_stem_minhash,
                    norm_options, norm_combined,
                    doc, tfidf_sims,
                    treat_number_changed_as_duplicate,
                    query_masked_stem_hash,
                    norm_query_stem=norm_stem,
                )
                if match is None:
                    continue
                overall_score = match['overallScore']
                if overall_score >= medium_threshold or match['exactHashMatch']:
                    match_type = self._determine_match_type(match, doc, treat_number_changed_as_duplicate)
                    # Apply visibility rules
                    safe_match = self._apply_visibility(match, doc, match_type, stem)
                    raw_matches.append(safe_match)

        raw_matches.sort(key=lambda m: m['overallScore'], reverse=True)
        top_matches = raw_matches[:max_results]

        highest_score = top_matches[0]['overallScore'] if top_matches else 0.0
        if highest_score >= exact_match_threshold:
            risk_level = 'EXACT'
        elif highest_score >= high_threshold:
            risk_level = 'HIGH'
        elif highest_score >= medium_threshold:
            risk_level = 'MEDIUM'
        elif highest_score > 0.25:
            risk_level = 'LOW'
        else:
            risk_level = 'NONE'

        return {
            'riskLevel': risk_level,
            'matches': top_matches,
            'totalMatches': len(top_matches),
        }

    def _apply_visibility(
        self,
        match: Dict[str, Any],
        doc: IndexedDocument,
        match_type: str,
        query_stem: str,
    ) -> Dict[str, Any]:
        """
        Apply visibility rules:
        - PAST_PAPER: full citation, matched text, spans, scores
        - BANK: only generic message + risk level + match type. NO code, NO text, NO fine score.
        """
        overall_score = match['overallScore']
        # Determine risk of this match
        if overall_score >= 1.0:
            risk = 'EXACT'
        elif overall_score >= 0.85:
            risk = 'HIGH'
        elif overall_score >= 0.60:
            risk = 'MEDIUM'
        else:
            risk = 'LOW'

        if doc.source_type == 'PAST_PAPER':
            spans = self._extract_matching_spans(query_stem, doc.raw_stem)
            return {
                'sourceType':  'PAST_PAPER',
                'matchType':   match_type,
                'riskLevel':   risk,
                'overallScore': overall_score,
                'citation':    doc.citation,
                'matchedText': doc.raw_stem[:500] + ('...' if len(doc.raw_stem) > 500 else ''),
                'spans':       spans,
            }
        else:
            # BANK: mask everything
            return {
                'sourceType':  'BANK',
                'matchType':   match_type,
                'riskLevel':   risk,
                'overallScore': overall_score,  # kept for internal server use; API layer strips this
                'bankMessage': 'Possible duplicate in the question bank',
            }

    def _determine_match_type(
        self,
        match: Dict[str, Any],
        doc: IndexedDocument,
        treat_number_changed_as_duplicate: bool,
    ) -> str:
        """Determine the match type for a scored pair."""
        if match['exactHashMatch'] and not match.get('_maskedOnly'):
            return MATCH_TYPE_EXACT
        if match.get('optionsReorderedMatch'):
            return MATCH_TYPE_OPTIONS_MATCH
        if match.get('_maskedOnly') and treat_number_changed_as_duplicate:
            return MATCH_TYPE_NUMBERS_CHANGED
        if match['overallScore'] >= 0.75:
            return MATCH_TYPE_NEAR
        return MATCH_TYPE_NEAR

    def _score_pair(
        self,
        query_exact_hash: str,
        query_masked_hash: str,
        query_stem_hash: str,
        query_minhash: MinHash,
        query_stem_minhash: MinHash,
        norm_query_options: List[str],
        norm_combined: str,
        doc: IndexedDocument,
        tfidf_sims: Dict[str, float],
        treat_number_changed_as_duplicate: bool,
        query_masked_stem_hash: str = '',
        norm_query_stem: str = '',
    ) -> Optional[Dict[str, Any]]:
        """Score a query against one indexed document. Returns None if below threshold."""
        exact_combined = (query_exact_hash == doc.exact_hash)
        exact_stem     = (query_stem_hash == doc.stem_hash)
        
        # Numbers changed means it didn't match unmasked, but matches when numbers are masked
        numbers_changed = not exact_combined and not exact_stem and (
            (query_masked_hash == doc.masked_hash) or
            (bool(query_masked_stem_hash) and query_masked_stem_hash == getattr(doc, 'masked_stem_hash', ''))
        )

        minhash_score      = query_minhash.jaccard(doc.minhash)
        stem_minhash_score = query_stem_minhash.jaccard(doc.stem_minhash)
        tfidf_score        = tfidf_sims.get(doc.doc_id, 0.0)

        # Substring / Containment check (critical for partial draft inputs or option-less stems)
        stem_containment = 0.0
        if norm_query_stem and len(norm_query_stem) >= 10:
            if norm_query_stem in doc.norm_stem or doc.norm_stem in norm_query_stem:
                ratio = len(norm_query_stem.split()) / max(1, len(doc.norm_stem.split()))
                stem_containment = max(0.90, min(1.0, ratio))
            else:
                q_words = set(norm_query_stem.split())
                d_words = set(doc.norm_stem.split())
                if len(q_words) >= 3 and len(q_words & d_words) >= 3:
                    overlap_ratio = len(q_words & d_words) / len(q_words)
                    if overlap_ratio >= 0.8:
                        stem_containment = max(0.85, overlap_ratio * 0.92)

        stem_score = max(1.0 if exact_stem else 0.0, stem_minhash_score, stem_containment)
        options_score, options_reordered = self._compare_options(norm_query_options, doc.norm_options)

        # Composite overall score
        if exact_combined:
            overall_score = 1.0
            masked_only = False
        elif exact_stem:
            overall_score = 1.0
            masked_only = False
        elif stem_containment >= 0.85:
            overall_score = max(0.90, stem_containment)
            masked_only = False
        elif options_reordered and exact_stem:
            overall_score = 0.95
            masked_only = False
        elif numbers_changed and treat_number_changed_as_duplicate:
            overall_score = max(0.92, tfidf_score, minhash_score)
            masked_only = True
        else:
            if stem_score >= 0.85:
                overall_score = max(stem_score, float(0.50 * stem_score + 0.30 * tfidf_score + 0.20 * minhash_score))
            else:
                overall_score = float(
                    0.45 * tfidf_score +
                    0.35 * minhash_score +
                    0.10 * stem_score +
                    0.10 * options_score
                )
            masked_only = False
            if options_reordered and stem_score > 0.7:
                overall_score = max(overall_score, 0.88)

        overall_score = round(min(1.0, max(0.0, overall_score)), 4)
        if overall_score < 0.3 and not exact_combined and not numbers_changed:
            return None

        # Snippet for PAST_PAPER/PUBLIC (safe — public data)
        source_snippet = None
        if doc.source_type in ('PAST_PAPER', 'PUBLIC'):
            source_snippet = doc.raw_stem[:300] + ('...' if len(doc.raw_stem) > 300 else '')

        matched_spans = self._extract_matching_spans(doc.raw_stem, doc.raw_stem)  # placeholder; actual used in visibility layer

        return {
            'sourceType':              doc.source_type,
            'sourceReference':         doc.source_reference,
            'matchedQuestionVersionId': doc.doc_id if doc.source_type == 'BANK' else None,
            'matchedDocumentId':       doc.doc_id if doc.source_type != 'BANK' else None,
            'overallScore':            overall_score,
            'exactHashMatch':          exact_combined,
            '_maskedOnly':             masked_only,
            'minhashScore':            round(minhash_score, 4),
            'tfidfScore':              round(tfidf_score, 4),
            'semanticScore':           None,
            'stemScore':               round(stem_score, 4),
            'optionsScore':            round(options_score, 4),
            'optionsReorderedMatch':   options_reordered,
            'matchedSpans':            [],
            'sourceTextSnippet':       source_snippet,
        }

    @staticmethod
    def _compute_tfidf_sims(norm_combined: str, index) -> Dict[str, float]:
        sims = {}
        if index.tfidf_vectorizer and index.tfidf_matrix is not None and index.doc_id_list:
            try:
                query_vec = index.tfidf_vectorizer.transform([norm_combined])
                scores = cosine_similarity(query_vec, index.tfidf_matrix)[0]
                for i, did in enumerate(index.doc_id_list):
                    sims[did] = float(scores[i])
            except Exception:
                pass
        return sims

    @staticmethod
    def _compare_options(q_opts: List[str], doc_opts: List[str]) -> Tuple[float, bool]:
        if not q_opts or not doc_opts:
            return 0.0, False
        q_sorted  = sorted(q_opts)
        doc_sorted = sorted(doc_opts)
        if q_sorted == doc_sorted:
            return 1.0, (q_opts != doc_opts)
        set_q = set(q_opts)
        set_d = set(doc_opts)
        overlap = len(set_q & set_d)
        union   = len(set_q | set_d)
        return (overlap / union if union > 0 else 0.0), False

    @staticmethod
    def _extract_matching_spans(query: str, target: str) -> List[Dict[str, Any]]:
        """Find common overlapping word tri-grams (3+ words) between query and target."""
        q_words = query.split()
        t_shingles = set(Normalizer.get_shingles(target.lower(), k=3))
        spans = []
        for i in range(len(q_words) - 2):
            trigram = f'{q_words[i].lower()} {q_words[i+1].lower()} {q_words[i+2].lower()}'
            if trigram in t_shingles:
                spans.append({'start': i, 'end': i + 3, 'text': f'{q_words[i]} {q_words[i+1]} {q_words[i+2]}'})
        return spans[:10]
