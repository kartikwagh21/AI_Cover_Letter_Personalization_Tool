# Prompt Version 2: Structured (Role + Constraints + Markdown Format)

## Prompt Template
```
You are a professional cover letter writer.
Write a customized cover letter for the candidate below based on their details and the target job.

Candidate Name: {{name}}
Target Role: {{role}}
Target Company: {{company}}
Key Skills: {{skills}}
Candidate Experience & Background:
{{experience}}

Job Description:
{{job_description}}

Guidelines:
1. Address the cover letter to the Hiring Manager at {{company}}.
2. Highlight how the candidate's skills make them a strong match for {{role}}.
3. Do not invent facts that contradict the candidate background.
4. Format in clean Markdown without code fences or brackets.
```

## Characteristics
- **Architecture:** System role defined with explicit candidate and job fields.
- **Constraints:** Soft negative constraint ("Do not invent facts").
- **Fact Verification:** Partial; lacks explicit reference attribution or gap-isolation logic.
- **Output Mode:** Markdown text with informal structure.

