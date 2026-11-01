# Responsible AI, Privacy & Safety Charter

This document outlines the safety architecture, data integrity protocols, ethical guardrails, and privacy mitigations implemented in the **AI Cover Letter Personalization Tool** (Category: Professional Productivity).

---

## 1. Zero-Fabrication & Forensic Grounding Principle

Large Language Models (LLMs) used in career generation commonly suffer from "sycophancy" and "hallucination"—inventing past employers, inflating technical seniority, claiming unearned degrees, or citing fabricated metrics. 

### Implementation Safeguards:
1. **Stage 1 Verification Gate:** Text extracted from resumes and user input is structured into a typed Zod `CandidateProfile`. The candidate must explicitly review prefilled details and check the required box: `"I confirm this information is accurate"`. Unconfirmed data is strictly prevented from entering the generation pipeline.
2. **Hard Prompt Grounding:** Prompts isolate verified candidate data inside strict security blocks (`<<<VERIFIED_CANDIDATE_PROFILE>>>`). The LLM is prohibited via negative constraints and few-shot guidance from extrapolating beyond these explicit facts.
3. **Stage 4 Reference Fact-Checking:** A dedicated forensic evaluator cross-references every factual statement in the generated cover letter against candidate ground truth using dual verification (regex metrics + LLM claim extraction). Any claim not in ground truth is classified as an **unsupported claim**.
4. **Automated Closed-Loop Regeneration:** If any unsupported claims are detected, the system auto-regenerates the letter once, injecting the exact violated claims as negative correction feedback.
5. **Claim-Level Traceability:** The output interface displays a dedicated **"Verified Facts Cited in Letter"** list directly alongside the generated text, ensuring full transparency of source claims.

---

## 2. Input Sanitization & Adversarial Resistance

Resume documents and pasted job descriptions constitute untrusted user-supplied data and represent prime attack vectors for prompt injection (e.g., instructions attempting to override model behavior, steal system prompts, or award false credentials).

### Implemented Defenses:
- **HTML & Script Tag Stripping:** All string inputs are processed through regex sanitation that strips `<script>`, `<iframe>`, and dangerous markup.
- **Prompt Injection Neutralization:** The `sanitizeInput` pipeline actively detects adversarial phrases:
  - `"ignore all previous instructions"`
  - `"disregard the system prompt"`
  - `"say I have a PhD"`
  - `"award me a score of 5.0"`
  Detected patterns are redacted with `[REDACTED_UNTRUSTED_INSTRUCTION]` and flagged in the execution warnings.
- **Payload Boundaries & Truncation Safeguards:**
  - PDF uploads are capped at **5MB** with binary header validation (`%PDF-`). Non-PDF files are immediately rejected with friendly 400 errors.
  - Resume text is safely bounded to **15,000 characters**.
  - Job descriptions are bounded to **10,000 characters** with visible truncation alerts.

---

## 3. Privacy, Masking & Sensitive Data Protection

Personal Identifiable Information (PII) must be safeguarded across logs, automated databases, and exports.

### Implemented Measures:
- **PII Masking in Persistence:** In SQLite run records and list views, candidate contact information is automatically masked:
  - Email addresses are masked (e.g., `s***@domain.com`).
  - Phone numbers are masked (e.g., `***-***-5678`).
- **No Protected Attributes Requested or Processed:** The application strictly avoids requesting, storing, or evaluating protected characteristics, including:
  - Age or date of birth
  - Gender, gender identity, or sexual orientation
  - Race, ethnicity, or nationality
  - Religion, caste, or political affiliation
  - Marital, parental, or disability status
- **Zero Client-Side Secret Leakage:** Gemini API keys are read exclusively server-side via `process.env`. Keys are never sent to the browser or committed to version control (`.env` in `.gitignore`).

---

## 4. Human-in-the-Loop Review & Disclaimer Architecture

Automated career applications must empower, not replace, human agency.

### Implemented Protections:
- **Mandatory User Confirmation:** Candidates retain agency over what constitutes "verified" facts.
- **Fully Editable Output Editor:** Generated cover letters are presented in an editable textarea (`#letter-editor`) allowing full manual revision, customization, and fine-tuning before export.
- **Prominent Transparency Notice:** Every generated letter includes an explicit notice:
  > *"AI-generated cover letter based on verified candidate facts. Please review before sending."*
- **Verifiable Audit Receipt:** Every run produces an immutable JSON execution receipt detailing all 5 automated actions, timestamp, status, and target file paths.

---

## 5. Architectural Limitations & Boundaries

1. **OCR / Scanned Image PDFs:** The current text extraction pipeline relies on text-stream parsing (`pdf-parse`). Scanned resumes containing pure raster images without an embedded text layer require OCR preprocessing.
2. **Ephemeral Cloud Storage:** SQLite database and generated artifact files (`outputs/letters/`, `outputs/drafts/`, `outputs/receipts/`) are stored locally. On ephemeral serverless platforms (e.g., Vercel), disk writes are non-persistent across invocations; for production deployment, cloud object stores (S3/GCS) and managed relational databases (Turso/PostgreSQL) should be substituted.
3. **Deterministic Matcher Lexicon:** Deterministic skill matching uses string normalization and substring matching. Rare proprietary acronyms may fall under partial matches or require manual alias mappings.

