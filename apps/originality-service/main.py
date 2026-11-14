import os
import socket
import logging
from typing import List, Optional, Dict, Any
from fastapi import FastAPI, HTTPException, Header, Depends
from pydantic import BaseModel, Field
from detector import OriginalityEngine, IndexedDocument

# Configure privacy-preserving logging: IDs and scores ONLY, NEVER question or draft text
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] [ORIGINALITY_SVC] %(message)s'
)
logger = logging.getLogger("originality_service")

# Authentication token for internal communication
INTERNAL_SERVICE_TOKEN = os.getenv("ORIGINALITY_SERVICE_TOKEN", "examvault_internal_secret_token_dev")

app = FastAPI(
    title="ExamVault Originality & Copy Checker Service",
    description="Internal, isolated originality detection engine for examination questions",
    version="2.0.0"
)

# Unified engine: bank (in-memory) + corpus (disk-persisted)
engine = OriginalityEngine(lsh_threshold=0.5)

# ── Authentication Dependency ──────────────────────────────────────
def verify_service_token(authorization: Optional[str] = Header(None)):
    if not authorization:
        raise HTTPException(status_code=401, detail="Missing service authorization token")
    token = authorization.replace("Bearer ", "").strip()
    if token != INTERNAL_SERVICE_TOKEN:
        logger.warning("Unauthorized service access attempt rejected")
        raise HTTPException(status_code=403, detail="Invalid internal service token")
    return True

# ── Request / Response Models ──────────────────────────────────────
class CheckQuestionRequest(BaseModel):
    questionId: str
    versionNo: int = 1
    stem: str
    options: List[str] = Field(default_factory=list)
    parentVersionId: Optional[str] = None
    authorId: Optional[str] = None
    exactMatchThreshold: float = 1.0
    highSimilarityThreshold: float = 0.85
    mediumSimilarityThreshold: float = 0.60
    treatNumberChangedAsDuplicate: bool = True

class CheckDraftRequest(BaseModel):
    stem: str
    options: List[str] = Field(default_factory=list)
    type: str = "MCQ_SINGLE"
    language: str = "en"
    subject: Optional[str] = ""
    topic: Optional[str] = ""
    exactMatchThreshold: float = 1.0
    highSimilarityThreshold: float = 0.85
    mediumSimilarityThreshold: float = 0.60
    treatNumberChangedAsDuplicate: bool = True
    examinerPseudonym: Optional[str] = None

class IndexFeedItem(BaseModel):
    docId: str
    sourceType: str = "BANK" # "BANK", "PAST_PAPER", "PUBLIC"
    sourceReference: str
    versionNo: int = 1
    stem: str
    options: List[str] = Field(default_factory=list)
    parentVersionId: Optional[str] = None
    authorId: Optional[str] = None
    citation: Optional[Dict[str, Any]] = None

class IndexFeedBatchRequest(BaseModel):
    items: List[IndexFeedItem]

class CorpusFeedBatchRequest(BaseModel):
    corpusId: str
    items: List[IndexFeedItem]
    rebuildTfidf: bool = False

class CorpusDisableRequest(BaseModel):
    corpusId: str

# ── API Endpoints ──────────────────────────────────────────────────

@app.get("/health")
def health_check():
    """Service health and index metrics for both bank and corpus"""
    bank_count = len(engine.bank.documents)
    corpus_count = len(engine.corpus.documents)
    return {
        "status": "HEALTHY",
        "service": "originality-service",
        "version": "2.0.0",
        "indexedBankDocumentsCount": bank_count,
        "indexedCorpusDocumentsCount": corpus_count,
        "indexedDocumentsCount": bank_count + corpus_count,
        "networkIsolationActive": True,
    }

@app.post("/check", dependencies=[Depends(verify_service_token)])
def check_originality(req: CheckQuestionRequest):
    """
    Screen a submitted question version against the bank and past-paper corpus.
    Logs ID, version, risk and scores — NEVER question text!
    """
    result = engine.check_question(
        question_id=req.questionId,
        version_no=req.versionNo,
        stem=req.stem,
        options=req.options,
        parent_version_id=req.parentVersionId,
        author_id=req.authorId,
        exact_match_threshold=req.exactMatchThreshold,
        high_threshold=req.highSimilarityThreshold,
        medium_threshold=req.mediumSimilarityThreshold,
        treat_number_changed_as_duplicate=req.treatNumberChangedAsDuplicate,
    )

    # Privacy-preserving logging
    logger.info(
        f"CHECK question_id={req.questionId} v={req.versionNo} "
        f"risk={result['riskLevel']} highest_score={result['highestScore']} "
        f"match_count={result['totalMatches']}"
    )

    return result

@app.post("/check-draft", dependencies=[Depends(verify_service_token)])
def check_draft_endpoint(req: CheckDraftRequest):
    """
    Live advisory check for an examiner writing a draft question.
    Drafts are NOT stored, NOT written to disk, NOT added to bank index, and NEVER logged.
    Logs ONLY examiner pseudonym, risk level, and match count.
    Visibility masking is strictly enforced:
      - PAST_PAPER: full citation, matched text snippet, overlapping spans
      - BANK: generic message only, NO code, NO text, NO fine score
    """
    result = engine.check_draft(
        stem=req.stem,
        options=req.options,
        question_type=req.type,
        language=req.language,
        subject=req.subject or "",
        topic=req.topic or "",
        exact_match_threshold=req.exactMatchThreshold,
        high_threshold=req.highSimilarityThreshold,
        medium_threshold=req.mediumSimilarityThreshold,
        treat_number_changed_as_duplicate=req.treatNumberChangedAsDuplicate,
        max_results=5,
    )

    # Privacy-preserving logging: ONLY actor pseudonym, risk level, match count
    actor = req.examinerPseudonym or "EXAMINER_ANONYMOUS"
    logger.info(
        f"DRAFT_CHECK actor={actor} "
        f"risk={result['riskLevel']} "
        f"matches={result['totalMatches']}"
    )

    return result

@app.post("/index/feed", dependencies=[Depends(verify_service_token)])
def feed_bank_index_batch(req: IndexFeedBatchRequest):
    """
    Populate or update in-memory bank index from internal authenticated feed.
    """
    count = 0
    for item in req.items:
        doc = IndexedDocument(
            doc_id=item.docId,
            source_type=item.sourceType,
            source_reference=item.sourceReference,
            version_no=item.versionNo,
            stem=item.stem,
            options=item.options,
            parent_version_id=item.parentVersionId,
            author_id=item.authorId,
            citation=item.citation,
        )
        engine.add_document(doc)
        count += 1

    engine.bank.rebuild_tfidf()
    logger.info(f"FEED_BATCH ingested={count} total_bank={len(engine.bank.documents)}")
    return {"success": True, "ingested": count, "totalIndexed": len(engine.bank.documents)}

@app.post("/corpus/feed", dependencies=[Depends(verify_service_token)])
def feed_corpus_batch(req: CorpusFeedBatchRequest):
    """
    Populate disk-persisted past-paper corpus index.
    """
    docs = []
    for item in req.items:
        doc = IndexedDocument(
            doc_id=item.docId,
            source_type="PAST_PAPER",
            source_reference=item.sourceReference,
            version_no=item.versionNo,
            stem=item.stem,
            options=item.options,
            citation=item.citation,
        )
        docs.append(doc)

    engine.corpus.add_corpus_batch(req.corpusId, docs)
    if req.rebuildTfidf:
        engine.corpus.rebuild_tfidf()
    logger.info(f"CORPUS_FEED corpus_id={req.corpusId} ingested={len(docs)} total_corpus={len(engine.corpus.documents)}")
    return {"success": True, "corpusId": req.corpusId, "ingested": len(docs), "totalCorpusIndexed": len(engine.corpus.documents)}

@app.post("/corpus/clear", dependencies=[Depends(verify_service_token)])
def clear_corpus_endpoint(req: CorpusDisableRequest):
    """Clear prior documents for a corpus before rebuilding"""
    engine.corpus.clear_corpus(req.corpusId)
    logger.info(f"CORPUS_CLEAR corpus_id={req.corpusId}")
    return {"success": True, "corpusId": req.corpusId}

@app.post("/corpus/finalize", dependencies=[Depends(verify_service_token)])
def finalize_corpus():
    """Rebuild TF-IDF matrix after all corpus batches are ingested"""
    engine.corpus.rebuild_tfidf()
    logger.info(f"CORPUS_FINALIZE total_corpus={len(engine.corpus.documents)}")
    return {"success": True, "totalCorpusIndexed": len(engine.corpus.documents)}

@app.post("/corpus/disable", dependencies=[Depends(verify_service_token)])
def disable_corpus(req: CorpusDisableRequest):
    """
    Remove disabled corpus questions from the live index.
    """
    engine.corpus.remove_corpus(req.corpusId)
    engine.corpus.rebuild_tfidf()
    logger.info(f"CORPUS_DISABLE corpus_id={req.corpusId} total_corpus_remaining={len(engine.corpus.documents)}")
    return {"success": True, "corpusId": req.corpusId, "totalCorpusIndexed": len(engine.corpus.documents)}

@app.post("/corpus/clear", dependencies=[Depends(verify_service_token)])
def clear_corpus():
    """Clear corpus index on disk and memory"""
    engine.corpus.clear()
    logger.info("CORPUS_CLEAR corpus index cleared")
    return {"success": True, "totalCorpusIndexed": 0}

@app.delete("/index/{doc_id}", dependencies=[Depends(verify_service_token)])
def remove_from_index(doc_id: str):
    """Remove a document from bank index upon retirement or withdrawal"""
    engine.remove_document(doc_id)
    logger.info(f"REMOVE_DOC doc_id={doc_id} total_bank={len(engine.bank.documents)}")
    return {"success": True, "removed": doc_id, "totalIndexed": len(engine.bank.documents)}

@app.post("/index/clear", dependencies=[Depends(verify_service_token)])
def clear_index():
    """Clear in-memory bank index for reload"""
    engine.clear()
    logger.info("CLEAR_INDEX in-memory bank store cleared")
    return {"success": True, "totalIndexed": 0}

@app.get("/test/network-isolation")
def test_network_isolation():
    """
    Automated test proving that external internet outbound requests fail.
    Attempts a socket connection to a public internet DNS IP (8.8.8.8:53 or example.com).
    Returns isolated: true if outbound network attempt is blocked.
    """
    outbound_blocked = False
    details = ""
    try:
        # Timeout quickly (1 second)
        s = socket.create_connection(("8.8.8.8", 53), timeout=1.0)
        s.close()
        outbound_blocked = False
        details = "Warning: Outbound socket connection succeeded. Ensure container has 'internal: true' network."
    except Exception as e:
        outbound_blocked = True
        details = f"Outbound connection correctly rejected: {type(e).__name__}"

    return {
        "isolated": outbound_blocked,
        "details": details,
        "policy": "No external internet access permitted"
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)
