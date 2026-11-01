# System Architecture & 4-Stage Workflow Diagram

The diagram below illustrates the end-to-end architecture of the **AI Cover Letter Personalization Tool**, detailing the client interface, the 4-stage pipeline, deterministic verification gates, automated trigger-action actions, and persistent storage.

```mermaid
flowchart TD
    %% User Inputs & Review
    subgraph UI ["Client Interface (Visual Baseline Preserved)"]
        A1["Candidate Details & Resume PDF"] --> A2["Stage 1: Review & Confirm<br/>(REQUIRED Confirmation Checkbox)"]
        A3["Job Description, Tone & Length Options"] --> A2
        A2 -->|"Confirmed Profile Only"| A4["Trigger: 'Generate Cover Letter'"]
    end

    %% 4-Stage Core Pipeline
    subgraph Pipeline ["4-Stage Backend Orchestration Pipeline"]
        direction TB
        S1["Stage 1: Intake & Verification<br/>- PDF parsing via pdf-parse<br/>- Prompt injection neutralization<br/>- Zod Schema: CandidateProfile"]
        
        S2["Stage 2: Job Analysis & Matching<br/>- LLM extracts requirements & values<br/>- Deterministic code matches skills<br/>- Calculates gaps & match rate %"]

        S3["Stage 3: Cover Letter Generation<br/>- Injects verified facts only (v3 master prompt)<br/>- Strict JSON: letter, facts_used, gaps<br/>- 1-turn repair retry on malformed JSON"]

        S4["Stage 4: Evaluation & Fact-Checking<br/>- Reference-based forensic fact-check<br/>- 5-Dimension Rubric (0-5) with weights<br/>- PASS criteria: overall >= 4.0 & 0 fake claims"]

        S1 --> S2 --> S3 --> S4
    end

    %% Closed-Loop Auto Regeneration Gate
    S4 -->|"Unsupported Claims > 0"| S3_RETRY["Auto-Regenerate Once<br/>(Feed back violations as corrections)"]
    S3_RETRY --> S4

    %% Automation & Persistence
    subgraph AutomationEngine ["Trigger-Action Automation (Ordered Steps)"]
        direction TB
        ACT1["1. Save Run to SQLite (Table: runs)"]
        ACT2["2. Export Styled DOCX (outputs/letters/)"]
        ACT3["3. Append CSV Log (outputs/applications_log.csv)"]
        ACT4["4. If Passed: Generate .eml Email Draft (outputs/drafts/)"]
        ACT5["5. Write Audit Receipt JSON (outputs/receipts/)"]

        ACT1 --> ACT2 --> ACT3 --> ACT4 --> ACT5
    end

    %% Connections
    A4 --> S1
    S4 -->|"Evaluation Complete"| AutomationEngine
    AutomationEngine -->|"Receipt & Scorecard"| B1["Right Panel Tabs:<br/>- Editable Letter & Citations<br/>- Match Analysis & Gaps<br/>- Rubric Breakdown<br/>- Automation Receipt"]
    ACT1 -->|"Persisted Records"| B2["History Modal &<br/>CSV / XLSX Exports"]
```

