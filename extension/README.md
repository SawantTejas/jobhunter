# JobFinder V0.6 Application Assistant

This is an unpacked Chrome/Chromium Manifest V3 extension. It has no cloud service, AI, autonomous browser control, or automatic submission. It runs only on your click. The Vercel dashboard cannot supply private answers.

## One-time setup

1. Open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select this project's **extension** directory. Edge uses `edge://extensions`.
2. Copy the extension ID shown there (or in the extension's **Local pairing** section).
3. In the JobFinder terminal run:

   ```powershell
   npm run assistant:setup -- YOUR_EXTENSION_ID
   npm run dev
   ```

   The setup uses the same compatible Node launcher as existing commands. It applies the SQLite migration, creates `data/application-profile.json`, and prints a random local pairing secret. It does not discover, apply to, or publish anything.

4. Edit **data/application-profile.json** with your real information. `config/application-profile.example.json` documents the base structure. Empty or missing answers remain unknown. Reopen the popup/rescan after editing.
5. On a normal application webpage, open the extension, expand **Local pairing**, paste the secret, and click **Save pairing**. Keep JobFinder's `npm run dev` process running on `127.0.0.1:5173`.

Re-run setup to rotate the secret or pair a different extension ID. Only one ID is paired at a time. Delete `data/assistant-pairing.json` to revoke access. Do not put the secret in source code. It is stored in Chrome's extension-local storage; temporary field suggestions use browser-session storage.

## Private profile

Existing candidate `yearsExperience`, factual resume work history, remote preference, and an existing accessible resume path are inherited when not overridden. They are not copied into a second profile. Candidate skills never imply a number of years using each skill. No contact, salary, education, authorization or relocation answers are inferred.

Additional optional fields and examples (replace example values with facts):

```json
{
  "experienceYears": 3,
  "noticePeriod": "30 days",
  "availableFrom": "2026-11-01",
  "currentCtc": "8 LPA INR",
  "expectedCtc": "12 LPA INR",
  "relocation": true,
  "remotePreference": "Remote or hybrid",
  "workAuthorization": {"IN": {"authorized": true, "sponsorshipRequired": false}},
  "skillYears": {"Laravel": 2, "PHP": 3},
  "workHistory": [{"company":"Actual employer","title":"Actual title","startDate":"2023-01","current":true}],
  "education": [{"institution":"Actual college","qualification":"Actual degree","field":"Actual field"}],
  "resumes": [{"id":"backend","label":"Backend CV","path":"D:\\JobFinder\\private-resumes\\backend.pdf"}],
  "defaultResumeId": "backend"
}
```

Merge these optional fields into the base profile, retaining contact/links/arrays. Omit unknown values; do not use example facts as real answers. Authorization keys currently recognize IN, US, GB and CA. Without a country in the question, eligibility remains unknown. A single education record/current employer can be suggested; ambiguous multiple records remain manual. Use PDF/DOC/DOCX resumes up to 10 MB. The service accepts only registered resume IDs, never paths from webpages. Resume files remain on your laptop until you explicitly click **Attach chosen resume** on a particular page. That action can trigger the website's normal upload handler.

## Daily flow

1. Open a job's **Apply** link in JobFinder, then navigate/login to the application yourself.
2. Open the extension. Select the matching opportunity; exact URL matches are preselected when unambiguous. Use **Find opportunity** when the ATS redirects to a different URL. The list shows up to 150 search matches.
3. Click **Detect / rescan this page**. It reports HIGH, MEDIUM, LOW and UNKNOWN fields with mapping reasons.
4. Click **Fill Known Fields** for HIGH-confidence blank controls. Existing values are preserved. Salary, availability, total experience, work authorization, checkbox/radio answers and long-form text need individual confirmation. Unit/currency conversions are never guessed.
5. For other fields, enter/select your answer and click **Confirm & fill**. Optionally check **Save confirmed answer for future forms**. Recurring concepts such as notice period and skill-specific years share confirmed answers. Unknown/long-form questions use exact normalized wording and always require confirmation, even after saving.
6. For detected resume/CV fields choose a variant and click **Attach chosen resume**. Other file uploads are manual.
7. Review and correct the website. Navigate multi-step forms yourself and **rescan each step**. The session stays associated with the selected job. No button here clicks Next or Submit.
8. Submit on the website yourself. Then reopen the popup, check **I reviewed and manually submitted**, and click **Mark Applied in JobFinder**. Refresh the local dashboard. Existing applied dates, history, calendar, streaks and analytics are used normally. Duplicate completion is idempotent and later statuses such as Interview are not downgraded.

## Limitations to test in your browser

- Test first with `test/fixtures/application-form.html` served by a local static server, or on an unsubmitted real form. When testing the fixture, do not mark a real opportunity Applied: that would update your real tracker. Chrome internal pages and file URLs without explicit file access cannot be injected. No special access is requested automatically.
- Native text/email/tel/number/date/url inputs, textareas, selects, radio groups, checkboxes and resume fields are supported. Controlled React forms receive native setters plus input/change events; verify that the ATS actually retains each value.
- This version inspects the **top document**. Cross-origin iframes, shadow DOM, rich-text editors, custom comboboxes, multi-select widgets and unusual hidden uploads require manual entry. It reports only detectable native controls, not a guarantee that every field was found.
- CAPTCHAs, login credentials, sensitive identity/demographic fields, consent/terms and signatures are protected and must be completed on the website. The extension never creates accounts, logs in, solves challenges, clicks submission controls, or chooses legal consent.
- No answer is inferred from a page's instructions. Field labels are untrusted data. Popup content uses text nodes; webpages cannot message the paired API through the content script.

## Storage and privacy

`data/application-profile.json` and `data/assistant-pairing.json` are private and ignored by Git. `application_answers` and `application_sessions` are private SQLite tables. Sessions track the opportunity, page URLs, detected/filled/unknown fields, selected resume and completion time. Deduplication reassigns sessions to the surviving opportunity without dropping application history.

The existing public export uses its explicit allowlist and has no access path to these fields. There are no changes to the public JSON schema or static Vercel application for V0.6. Private API routes exist only in the local Vite configuration, require loopback access and the paired extension secret/identity, and do not accept arbitrary browser origins. Do not share your private data directory or pairing secret.

Targeted local checks: `npm run test:assistant`. These tests use temporary SQLite databases, a loopback HTTP fixture, and simulated native controls. They never discover jobs, contact employers, upload a real resume, submit an application, or publish. Actual Chrome/ATS behavior still needs the manual checks above.
