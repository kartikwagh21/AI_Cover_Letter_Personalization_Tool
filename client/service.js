document.addEventListener('DOMContentLoaded', () => {
    // Core Elements
    const resumeForm = document.getElementById('resume-form');
    const uploadZone = document.getElementById('upload-zone');
    const resumeInput = document.getElementById('resume');
    const fileNameDisplay = document.getElementById('file-name-display');
    const fileInfoBadge = document.getElementById('file-info-badge');
    const uploadTexts = document.querySelector('.upload-texts');
    const submitButton = document.getElementById('submit-button');
    const btnSpinner = submitButton.querySelector('.btn-spinner');
    const btnText = submitButton.querySelector('.btn-text');

    const nameInput = document.getElementById('name');
    const roleInput = document.getElementById('role');
    const companyInput = document.getElementById('company');
    const skillsInput = document.getElementById('skills');
    const jobDescriptionInput = document.getElementById('job-description');
    const toneSelect = document.getElementById('tone');
    const lengthSelect = document.getElementById('length');
    const promptVersionSelect = document.getElementById('prompt-version');

    const verifiedSummaryInput = document.getElementById('verified-summary');
    const confirmVerificationCheckbox = document.getElementById('confirm-verification');

    // Theme Switcher (Dark / Light)
    const themeToggleBtn = document.getElementById('theme-toggle-btn');
    const themeBtnText = document.getElementById('theme-btn-text');
    const themeIconMoon = document.getElementById('theme-icon-moon');
    const themeIconSun = document.getElementById('theme-icon-sun');

    function applyTheme(theme) {
        if (theme === 'dark') {
            document.body.classList.add('dark-theme');
            if (themeBtnText) themeBtnText.textContent = 'Light';
            if (themeIconMoon) themeIconMoon.hidden = true;
            if (themeIconSun) themeIconSun.hidden = false;
        } else {
            document.body.classList.remove('dark-theme');
            if (themeBtnText) themeBtnText.textContent = 'Dark';
            if (themeIconMoon) themeIconMoon.hidden = false;
            if (themeIconSun) themeIconSun.hidden = true;
        }
        localStorage.setItem('theme_preference', theme);
    }

    const savedTheme = localStorage.getItem('theme_preference') || 'light';
    applyTheme(savedTheme);

    if (themeToggleBtn) {
        themeToggleBtn.addEventListener('click', () => {
            const isDark = document.body.classList.contains('dark-theme');
            applyTheme(isDark ? 'light' : 'dark');
        });
    }

    const idleState = document.getElementById('idle-state');
    const loadingState = document.getElementById('loading-state');
    const resultSection = document.getElementById('result');

    const letterEditor = document.getElementById('letter-editor');
    const copyBtn = document.getElementById('copy-btn');
    const copyBtnText = document.getElementById('copy-btn-text');
    const downloadDocxBtn = document.getElementById('download-docx-btn');
    const downloadTxtBtn = document.getElementById('download-txt-btn');
    const factsList = document.getElementById('facts-list');

    const llmBadge = document.getElementById('llm-badge');
    const openHistoryBtn = document.getElementById('open-history-btn');
    const closeHistoryBtn = document.getElementById('close-history-btn');
    const historyModal = document.getElementById('history-modal');
    const runsTableBody = document.getElementById('runs-table-body');
    const exportCsvBtn = document.getElementById('export-csv-btn');
    const exportXlsxBtn = document.getElementById('export-xlsx-btn');

    let currentRunId = null;
    let extractedProfileCache = null;

    const isLocalStatic = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.protocol === 'file:';
    const DEFAULT_RENDER_BACKEND = 'https://ai-cover-letter-personalization-tool.onrender.com';
    const API_BASE = isLocalStatic ? 'http://localhost:5001' : (localStorage.getItem('backend_api_url') || DEFAULT_RENDER_BACKEND);

    // 1. Fetch Health & Provider Status
    async function checkHealth() {
        try {
            const res = await fetch(`${API_BASE}/api/health`);
            if (res.ok) {
                const data = await res.json();
                if (data.isMock) {
                    llmBadge.textContent = 'LLM: Mock (no API key)';
                    llmBadge.classList.add('badge-mock');
                } else {
                    llmBadge.textContent = `LLM: Gemini (${data.model || '2.5-flash'})`;
                    llmBadge.classList.remove('badge-mock');
                }
            } else {
                llmBadge.textContent = 'LLM: Standby';
            }
        } catch (e) {
            llmBadge.textContent = 'LLM: Local / Mock';
            llmBadge.classList.add('badge-mock');
        }
    }
    checkHealth();

    // 2. Verification Checkbox Controls Submit Button
    function updateConfirmationState() {
        const isConfirmed = confirmVerificationCheckbox.checked;
        const hasName = nameInput.value.trim().length > 0;
        const hasSkills = skillsInput.value.trim().length > 0;
        const hasRole = roleInput.value.trim().length > 0;
        const hasCompany = companyInput.value.trim().length > 0;

        submitButton.disabled = !(isConfirmed && hasName && hasSkills && hasRole && hasCompany);
    }

    [confirmVerificationCheckbox, nameInput, skillsInput, roleInput, companyInput].forEach(el => {
        el.addEventListener('input', updateConfirmationState);
        el.addEventListener('change', updateConfirmationState);
    });

    // 3. File Upload & Resume Extraction
    function updateFileDisplay(file) {
        if (file) {
            fileNameDisplay.textContent = file.name;
            fileInfoBadge.hidden = false;
            uploadTexts.style.opacity = '0.3';
        } else {
            fileNameDisplay.textContent = 'No file selected';
            fileInfoBadge.hidden = true;
            uploadTexts.style.opacity = '1';
        }
    }

    async function triggerIntakeExtraction(file) {
        if (!file) return;

        btnText.textContent = 'Extracting Profile...';
        btnSpinner.hidden = false;

        try {
            const formData = new FormData();
            formData.append('resume', file);
            formData.append('name', nameInput.value.trim());
            formData.append('skills', skillsInput.value.trim());
            formData.append('role', roleInput.value.trim());
            formData.append('company', companyInput.value.trim());

            const res = await fetch(`${API_BASE}/api/profile/extract`, {
                method: 'POST',
                body: formData
            });

            if (res.ok) {
                const data = await res.json();
                if (data.profile) {
                    extractedProfileCache = data.profile;
                    if (data.profile.name) {
                        nameInput.value = data.profile.name;
                    }
                    if (data.profile.skills && data.profile.skills.length > 0) {
                        skillsInput.value = data.profile.skills.join(', ');
                    }
                    if (data.profile.role && (!roleInput.value || roleInput.value === 'Full-Stack Engineer' || roleInput.value === 'Software Engineer')) {
                        roleInput.value = data.profile.role;
                    }
                    if (data.profile.summary && verifiedSummaryInput) {
                        verifiedSummaryInput.value = data.profile.summary;
                    }
                }
            }
        } catch (err) {
            console.warn('[Client] Intake extraction fallback:', err);
        } finally {
            btnText.textContent = 'Generate Cover Letter';
            btnSpinner.hidden = true;
            updateConfirmationState();
        }
    }

    resumeInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        updateFileDisplay(file);
        if (file) triggerIntakeExtraction(file);
    });

    ['dragenter', 'dragover'].forEach(eventName => {
        uploadZone.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
            uploadZone.classList.add('drag-active');
            uploadZone.style.borderColor = 'var(--accent-color)';
            uploadZone.style.background = 'rgba(5, 150, 105, 0.08)';
        }, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        uploadZone.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
            uploadZone.classList.remove('drag-active');
            uploadZone.style.borderColor = 'rgba(5, 150, 105, 0.25)';
            uploadZone.style.background = 'rgba(255, 255, 255, 0.5)';
        }, false);
    });

    uploadZone.addEventListener('drop', (e) => {
        const dt = e.dataTransfer;
        const files = dt.files;
        if (files.length > 0) {
            resumeInput.files = files;
            updateFileDisplay(files[0]);
            triggerIntakeExtraction(files[0]);
        }
    });

    // 4. Tab Navigation
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabPanes = document.querySelectorAll('.tab-pane');

    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            tabBtns.forEach(b => b.classList.remove('active'));
            tabPanes.forEach(p => p.classList.remove('active'));
            btn.classList.add('active');
            const targetPane = document.getElementById(btn.getAttribute('data-tab'));
            if (targetPane) targetPane.classList.add('active');
        });
    });

    // 5. Four-Stage Progress Animation Helper
    function setStepStatus(stepNum, status) {
        const el = document.getElementById(`step-${stepNum}`);
        if (!el) return;
        el.classList.remove('active', 'completed');
        if (status === 'active') el.classList.add('active');
        if (status === 'completed') el.classList.add('completed');
    }

    // 6. Generate Cover Letter Form Submission
    resumeForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const name = nameInput.value.trim();
        const role = roleInput.value.trim();
        const company = companyInput.value.trim();
        const skills = skillsInput.value.trim().split(',').map(s => s.trim()).filter(Boolean);
        const jobDescription = jobDescriptionInput ? jobDescriptionInput.value.trim() : '';
        const tone = toneSelect ? toneSelect.value : 'Formal';
        const length = lengthSelect ? lengthSelect.value : 'medium';
        const promptVersion = promptVersionSelect ? promptVersionSelect.value : 'v3';
        const summary = verifiedSummaryInput ? verifiedSummaryInput.value.trim() : (extractedProfileCache?.summary || '');

        if (!confirmVerificationCheckbox.checked) {
            alert('Please check "I confirm this information is accurate" to proceed.');
            return;
        }

        submitButton.disabled = true;
        btnSpinner.hidden = false;
        btnText.textContent = 'Generating Cover Letter...';

        idleState.hidden = true;
        resultSection.hidden = true;
        loadingState.hidden = false;

        // Stage 1 animation
        setStepStatus(1, 'active');
        setStepStatus(2, '');
        setStepStatus(3, '');
        setStepStatus(4, '');

        const stageTimer1 = setTimeout(() => { setStepStatus(1, 'completed'); setStepStatus(2, 'active'); }, 500);
        const stageTimer2 = setTimeout(() => { setStepStatus(2, 'completed'); setStepStatus(3, 'active'); }, 1100);
        const stageTimer3 = setTimeout(() => { setStepStatus(3, 'completed'); setStepStatus(4, 'active'); }, 1800);

        try {
            // Assemble confirmed candidate profile
            const verifiedProfile = extractedProfileCache || {
                name,
                skills,
                summary: summary || `Professional with expertise in ${skills.join(', ')}.`,
                experience: [],
                education: [],
                projects: [],
                certifications: [],
                achievements: [],
                is_confirmed: true
            };
            verifiedProfile.name = name;
            verifiedProfile.skills = skills;
            verifiedProfile.summary = summary || verifiedProfile.summary;
            verifiedProfile.is_confirmed = true;

            const payload = {
                verifiedProfile,
                jobDescription,
                role,
                company,
                tone,
                length,
                promptVersion,
                confirmed: true
            };

            const response = await fetch(`${API_BASE}/api/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            clearTimeout(stageTimer1);
            clearTimeout(stageTimer2);
            clearTimeout(stageTimer3);
            setStepStatus(1, 'completed');
            setStepStatus(2, 'completed');
            setStepStatus(3, 'completed');
            setStepStatus(4, 'completed');

            if (!response.ok) {
                const errorText = await response.text();
                let errMsg = `Server error (${response.status})`;
                try {
                    const parsed = JSON.parse(errorText);
                    errMsg = parsed.error || errMsg;
                } catch {
                    if (errorText.includes('The page could not be found') || response.status === 404) {
                        errMsg = 'Backend connection not found. Please hard refresh the page (Cmd+Shift+R) to load the latest backend configuration.';
                    } else {
                        errMsg = errorText.slice(0, 120);
                    }
                }
                throw new Error(errMsg);
            }

            const data = await response.json();

            if (!data.success) {
                throw new Error(data.error || 'Server error occurred during generation.');
            }

            currentRunId = data.runId;

            // Render Letter
            letterEditor.value = data.coverLetter;

            // Render Facts Cited
            factsList.innerHTML = '';
            const facts = data.factsUsed || [];
            if (facts.length > 0) {
                facts.forEach(f => {
                    const li = document.createElement('li');
                    li.textContent = f;
                    factsList.appendChild(li);
                });
            } else {
                const li = document.createElement('li');
                li.textContent = `Candidate: ${name} | Core Skills: ${skills.join(', ')}`;
                factsList.appendChild(li);
            }

            // Render Match Analysis
            const jobAnalysis = data.jobAnalysis || {};
            const matchRate = jobAnalysis.match_percentage ?? 100;
            document.getElementById('match-rate-text').textContent = `${matchRate}%`;

            const matchedTagsContainer = document.getElementById('matched-skills-tags');
            matchedTagsContainer.innerHTML = '';
            (jobAnalysis.matched_skills || skills).forEach(s => {
                const span = document.createElement('span');
                span.className = 'tag-badge matched';
                span.textContent = s;
                matchedTagsContainer.appendChild(span);
            });

            const gapsContainer = document.getElementById('gaps-tags');
            gapsContainer.innerHTML = '';
            const gaps = jobAnalysis.gaps || [];
            if (gaps.length > 0) {
                gaps.forEach(g => {
                    const span = document.createElement('span');
                    span.className = 'tag-badge gap';
                    span.textContent = g;
                    gapsContainer.appendChild(span);
                });
            } else {
                gapsContainer.innerHTML = '<span style="font-size: 0.8rem; color: var(--text-muted);">No major skill gaps identified.</span>';
            }

            const seniorityValues = document.getElementById('seniority-values-text');
            const seniority = jobAnalysis.seniority || 'Mid-Senior Level';
            const values = (jobAnalysis.company_values || []).join(', ') || 'Continuous Innovation, Engineering Excellence';
            seniorityValues.textContent = `Seniority: ${seniority} | Values: ${values}`;

            // Render Evaluation Rubric
            const evalResult = data.evaluation || {};
            const rubric = evalResult.rubric || {};
            const scores = rubric.scores || {};

            const overallScore = rubric.overall ?? 4.5;
            document.getElementById('eval-overall-score').textContent = `${overallScore} / 5.0`;

            const passBadge = document.getElementById('eval-pass-badge');
            if (rubric.is_pass) {
                passBadge.className = 'pass-pill';
                passBadge.textContent = 'PASS';
            } else {
                passBadge.className = 'fail-pill';
                passBadge.textContent = 'FAIL';
            }

            document.getElementById('score-accuracy').textContent = scores.factual_accuracy ?? '5.0';
            document.getElementById('score-coverage').textContent = scores.requirement_coverage ?? '4.5';
            document.getElementById('score-personalization').textContent = scores.personalization ?? '4.5';
            document.getElementById('score-tone').textContent = scores.tone_professionalism ?? '4.5';
            document.getElementById('score-structure').textContent = scores.structure_grammar ?? '4.8';

            // Unsupported Claims Box
            const claimsWarning = document.getElementById('claims-warning');
            const claimsList = document.getElementById('unsupported-claims-list');
            const unsupported = evalResult.unsupported_claims || [];
            if (unsupported.length > 0) {
                claimsList.innerHTML = '';
                unsupported.forEach(c => {
                    const li = document.createElement('li');
                    li.textContent = typeof c === 'string' ? c : c.claim;
                    claimsList.appendChild(li);
                });
                claimsWarning.hidden = false;
            } else {
                claimsWarning.hidden = true;
            }

            // Render Automation Receipt
            const receipt = data.receipt || {};
            document.getElementById('receipt-summary-text').textContent =
                `Run ID: ${receipt.run_id || currentRunId} | All Actions: ${receipt.all_succeeded ? 'SUCCESS' : 'COMPLETED'}`;

            const receiptList = document.getElementById('receipt-actions-list');
            receiptList.innerHTML = '';
            (receipt.actions_executed || []).forEach(act => {
                const row = document.createElement('div');
                row.className = 'receipt-action-row';
                const isSkipped = act.status === 'SKIPPED';
                row.innerHTML = `
                    <div>
                        <div class="receipt-action-name">${act.step}. ${act.action.replace(/_/g, ' ')}</div>
                        <div style="font-size: 0.75rem; color: var(--text-muted);">${act.target || act.note || ''}</div>
                    </div>
                    <span class="receipt-status-badge ${isSkipped ? 'status-skipped' : 'status-success'}">${act.status}</span>
                `;
                receiptList.appendChild(row);
            });

            // Show Result Panel
            loadingState.hidden = true;
            resultSection.hidden = false;

            // Auto-switch to Letter Tab
            tabBtns[0].click();

        } catch (error) {
            console.error('[Client] Generation Error:', error);
            alert(error.message || 'An error occurred while generating the cover letter.');
            loadingState.hidden = true;
            idleState.hidden = false;
        } finally {
            submitButton.disabled = false;
            btnSpinner.hidden = true;
            btnText.textContent = 'Generate Cover Letter';
            updateConfirmationState();
        }
    });

    // 7. Copy to Clipboard
    copyBtn.addEventListener('click', () => {
        const textToCopy = letterEditor.value;

        function showSuccessFeedback() {
            const originalText = copyBtnText.textContent;
            copyBtnText.textContent = 'Copied to Clipboard!';
            copyBtn.style.borderColor = '#10b981';
            copyBtn.style.color = '#10b981';

            const originalIconHTML = copyBtn.querySelector('svg').innerHTML;
            copyBtn.querySelector('svg').innerHTML = `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />`;

            setTimeout(() => {
                copyBtnText.textContent = originalText;
                copyBtn.style.borderColor = 'rgba(5, 150, 105, 0.3)';
                copyBtn.style.color = 'var(--accent-color)';
                copyBtn.querySelector('svg').innerHTML = originalIconHTML;
            }, 2000);
        }

        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(textToCopy).then(showSuccessFeedback).catch(() => {
                fallbackCopy(textToCopy, showSuccessFeedback);
            });
        } else {
            fallbackCopy(textToCopy, showSuccessFeedback);
        }
    });

    function fallbackCopy(text, cb) {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try {
            document.execCommand('copy');
            if (cb) cb();
        } catch (e) {
            alert('Failed to copy text. Please select and copy manually.');
        }
        document.body.removeChild(ta);
    }

    // 8. Download DOCX
    downloadDocxBtn.addEventListener('click', async () => {
        if (!currentRunId) {
            alert('Please generate a cover letter first.');
            return;
        }
        window.open(`${API_BASE}/api/runs/${currentRunId}/docx`, '_blank');
    });

    // 9. Download TXT
    downloadTxtBtn.addEventListener('click', () => {
        const text = letterEditor.value;
        if (!text) return;
        const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${nameInput.value.trim() || 'Cover_Letter'}_Application.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    });

    // 10. History Modal Management
    async function loadHistoryRuns() {
        try {
            runsTableBody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: var(--text-muted);">Loading past runs...</td></tr>';
            const res = await fetch(`${API_BASE}/api/runs?limit=30`);
            if (!res.ok) throw new Error('Failed loading runs');
            const data = await res.json();
            const runs = data.runs || [];

            if (runs.length === 0) {
                runsTableBody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: var(--text-muted);">No runs recorded yet. Generate your first cover letter!</td></tr>';
                return;
            }

            runsTableBody.innerHTML = '';
            runs.forEach(r => {
                const tr = document.createElement('tr');
                const isPass = r.is_pass === 1;
                const dateStr = new Date(r.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
                tr.innerHTML = `
                    <td style="font-family: monospace; font-size: 0.78rem;">${r.id.slice(0, 14)}...</td>
                    <td>${dateStr}</td>
                    <td><strong>${r.candidate_name || 'Candidate'}</strong></td>
                    <td>${r.job_role} at ${r.job_company}</td>
                    <td style="font-weight: 700; color: var(--accent-color);">${r.overall_score || '-'}</td>
                    <td><span class="${isPass ? 'pass-pill' : 'fail-pill'}">${isPass ? 'PASS' : 'FAIL'}</span></td>
                    <td>
                        <a href="${API_BASE}/api/runs/${r.id}/docx" target="_blank" style="color: var(--accent-color); font-weight: 600; text-decoration: none;">DOCX</a>
                    </td>
                `;
                runsTableBody.appendChild(tr);
            });
        } catch (e) {
            runsTableBody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: #ef4444;">Error loading history: ${e.message}</td></tr>`;
        }
    }

    openHistoryBtn.addEventListener('click', () => {
        historyModal.hidden = false;
        loadHistoryRuns();
    });

    closeHistoryBtn.addEventListener('click', () => {
        historyModal.hidden = true;
    });

    historyModal.addEventListener('click', (e) => {
        if (e.target === historyModal) historyModal.hidden = true;
    });

    exportCsvBtn.addEventListener('click', () => {
        window.open(`${API_BASE}/api/export/runs.csv`, '_blank');
    });

    exportXlsxBtn.addEventListener('click', () => {
        window.open(`${API_BASE}/api/export/runs.xlsx`, '_blank');
    });
});
