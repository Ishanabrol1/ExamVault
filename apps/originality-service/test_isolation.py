import sys
import io
import os
import logging
import urllib.request
import urllib.error

from normalizer import Normalizer
from detector import (
    OriginalityEngine,
    IndexedDocument,
    MATCH_TYPE_EXACT,
    MATCH_TYPE_NEAR,
    MATCH_TYPE_NUMBERS_CHANGED,
    MATCH_TYPE_OPTIONS_MATCH,
)

def test_outbound_internet_isolation_fails():
    """Verify outbound internet access fails or is blocked."""
    try:
        urllib.request.urlopen("http://198.51.100.1:80", timeout=1.0)
        raise AssertionError("Outbound request should not succeed in isolated network")
    except (urllib.error.URLError, TimeoutError, OSError):
        # Expected failure: isolated network cannot reach external IP
        pass

def test_draft_check_privacy_and_visibility():
    """Verify draft check enforces strict visibility masking and log confidentiality."""
    log_capture = io.StringIO()
    handler = logging.StreamHandler(log_capture)
    logger = logging.getLogger()
    logger.setLevel(logging.INFO)
    logger.addHandler(handler)

    engine = OriginalityEngine()

    # 1. Add a secret question to the bank index
    bank_doc = IndexedDocument(
        doc_id="bank-confidential-001",
        source_type="BANK",
        source_reference="EV-PHY-009999",
        version_no=1,
        stem="Confidential quantum bank item: what is the energy of a photon with wavelength 500 nm?",
        options=["2.48 eV", "1.24 eV", "3.10 eV", "4.96 eV"],
    )
    engine.add_document(bank_doc)

    # 2. Add a public past-paper question to the corpus index
    corpus_doc = IndexedDocument(
        doc_id="pastpaper-public-001",
        source_type="PAST_PAPER",
        source_reference="JEE Advanced::2022::15::en",
        version_no=1,
        stem="Archived 2022 past paper: calculate the magnetic field at the center of a circular loop carrying current I.",
        options=["mu0 I / 2R", "mu0 I / 4R", "mu0 I / R", "zero"],
        citation={
            "source_exam": "JEE Advanced",
            "year": 2022,
            "shift": "Morning",
            "paper_code": "Paper-1",
            "question_no": "15",
        }
    )
    engine.corpus.add_corpus_batch("corpus_2022", [corpus_doc])

    # Check 1: Query against Bank Document
    draft_bank = engine.check_draft(
        stem="Confidential quantum bank item: what is the energy of a photon with wavelength 500 nm?",
        options=["2.48 eV", "1.24 eV", "3.10 eV", "4.96 eV"],
        question_type="MCQ_SINGLE",
    )

    assert len(draft_bank["matches"]) > 0, "Expected match against bank question"
    bm = draft_bank["matches"][0]
    assert bm["sourceType"] == "BANK"
    # STRICT SECURITY RULE: Bank match must NOT leak code, text, or fine score
    assert "EV-PHY-009999" not in str(bm), "Bank question code leaked in draft match!"
    assert "Confidential quantum bank item" not in str(bm), "Bank question text leaked in draft match!"
    assert bm.get("matchedText") is None, "Bank text snippet exposed to examiner!"
    assert bm.get("citation") is None, "Citation exposed on bank question!"
    assert bm.get("bankMessage") == "Possible duplicate in the question bank"
    print("PASS: Bank matches enforce strict privacy (no code, no text, no fine score).")

    # Check 2: Query against Past Paper Document
    draft_pp = engine.check_draft(
        stem="Archived 2022 past paper: calculate the magnetic field at the center of a circular loop carrying current I.",
        options=["mu0 I / 2R", "mu0 I / 4R", "mu0 I / R", "zero"],
        question_type="MCQ_SINGLE",
    )
    assert len(draft_pp["matches"]) > 0, "Expected match against past paper"
    ppm = draft_pp["matches"][0]
    assert ppm["sourceType"] == "PAST_PAPER"
    assert ppm["citation"] is not None
    assert ppm["citation"]["source_exam"] == "JEE Advanced"
    assert ppm["citation"]["year"] == 2022
    assert ppm["citation"]["question_no"] == "15"
    assert "circular loop" in ppm["matchedText"]
    assert len(ppm["spans"]) > 0
    print("PASS: Past paper matches correctly return citations, snippets, and highlighted spans.")

    # Check 3: Verify draft text is NOT in bank index or disk
    assert "Confidential quantum bank item" not in engine.corpus.documents, "Draft stored in corpus!"
    # Ensure no temporary leak in logs
    log_output = log_capture.getvalue()
    assert "photon with wavelength 500 nm" not in log_output, "Draft text leaked into logs!"
    print("PASS: Draft text is never logged or added to corpus index.")

def test_number_changed_and_options_match():
    """Verify number-changed policy flag and option reordering detection."""
    engine = OriginalityEngine()

    corpus_doc = IndexedDocument(
        doc_id="num-test-01",
        source_type="PAST_PAPER",
        source_reference="JEE Main::2021::5::en",
        version_no=1,
        stem="A car of mass 1000 kg accelerates uniformly from 0 to 20 m/s in 10 seconds.",
        options=["2000 N", "1000 N", "4000 N", "500 N"],
        citation={"source_exam": "JEE Main", "year": 2021, "question_no": "5"}
    )
    engine.corpus.add_corpus_batch("test_num", [corpus_doc])

    # Variant with numbers changed: 1000 -> 2500, 20 -> 50, 10 -> 25
    num_query_stem = "A car of mass 2500 kg accelerates uniformly from 0 to 50 m/s in 25 seconds."

    # When policy treats numbers changed as duplicate:
    res_flagged = engine.check_draft(
        stem=num_query_stem,
        options=["Option 1", "Option 2", "Option 3", "Option 4"],
        question_type="MCQ_SINGLE",
        treat_number_changed_as_duplicate=True,
    )
    assert len(res_flagged["matches"]) > 0
    assert res_flagged["matches"][0]["matchType"] == "NUMBERS_CHANGED"
    print("PASS: Numbers-changed variant flagged as NUMBERS_CHANGED when policy enabled.")

    # When policy does NOT treat numbers changed as duplicate:
    res_unflagged = engine.check_draft(
        stem=num_query_stem,
        options=["Option 1", "Option 2", "Option 3", "Option 4"],
        question_type="MCQ_SINGLE",
        treat_number_changed_as_duplicate=False,
    )
    # The score should be substantially lower without masked matching
    score_unflagged = res_unflagged["matches"][0]["overallScore"] if res_unflagged["matches"] else 0.0
    assert score_unflagged < res_flagged["matches"][0]["overallScore"], "Policy disable did not lower score"
    print("PASS: Numbers-changed policy flag correctly respects disabled state.")

    # Option reordering test
    res_opts = engine.check_draft(
        stem="A car of mass 1000 kg accelerates uniformly from 0 to 20 m/s in 10 seconds.",
        options=["500 N", "4000 N", "1000 N", "2000 N"], # Scrambled order
        question_type="MCQ_SINGLE",
    )
    assert len(res_opts["matches"]) > 0
    assert res_opts["matches"][0]["matchType"] in (MATCH_TYPE_OPTIONS_MATCH, MATCH_TYPE_EXACT)
    print("PASS: Reordered options detected correctly.")

def test_corpus_disable_removes_from_live_index():
    """Verify disabling a corpus removes all its documents from live search."""
    engine = OriginalityEngine()
    doc = IndexedDocument(
        doc_id="retire-doc-01",
        source_type="PAST_PAPER",
        source_reference="BITSAT::2018::1::en",
        version_no=1,
        stem="Unique vintage question: determine dipole moment of carbon tetrachloride.",
        options=["0 D", "1.5 D", "2.1 D", "3.0 D"],
        citation={"source_exam": "BITSAT", "year": 2018, "question_no": "1"}
    )
    engine.corpus.add_corpus_batch("vintage_corpus", [doc])

    # Should match before disable
    before = engine.check_draft(
        stem="Unique vintage question: determine dipole moment of carbon tetrachloride.",
        options=["0 D", "1.5 D", "2.1 D", "3.0 D"],
        question_type="MCQ_SINGLE",
    )
    assert len(before["matches"]) > 0

    # Remove corpus
    engine.corpus.remove_corpus("vintage_corpus")

    # Should NOT match after disable
    after = engine.check_draft(
        stem="Unique vintage question: determine dipole moment of carbon tetrachloride.",
        options=["0 D", "1.5 D", "2.1 D", "3.0 D"],
        question_type="MCQ_SINGLE",
    )
    assert len(after["matches"]) == 0
    print("PASS: Disabled corpus immediately removed from live checks.")

if __name__ == "__main__":
    print("=" * 60)
    print("Running ExamVault Originality Confidentiality, Isolation & Corpus Tests...")
    print("=" * 60)
    test_outbound_internet_isolation_fails()
    print("PASS: Network isolation verified (no outbound internet access).")
    test_draft_check_privacy_and_visibility()
    test_number_changed_and_options_match()
    test_corpus_disable_removes_from_live_index()
    print("\nALL STEP 2 ADD-ON ISOLATION, PRIVACY & MATCHING TESTS PASSED.")
