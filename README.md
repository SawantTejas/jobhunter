# JobHunter — V0.3

India-first discovery and explainable ranking with a small React dashboard and private SQLite database. Local, CPU-only; no AI, hosted database, or automatic applications.

## V0.3 history, streaks and analytics

Open **Calendar / History** for a monthly activity calendar and click a day to see the applications and their current outcomes. **Analytics** includes daily trends (7/30/90 days or all time), current status, location, opportunity type, canonical source, weekday activity, recorded progression and match-score buckets. The landing feed has a compact summary and two charts. All calculations run in the browser from the sanitized snapshot; Vercel remains fully static and read-only.

**Export CSV** downloads all tracked applications, independent of the current feed filter. Files use UTF-8 BOM, CRLF, quoted fields and Excel formula-injection protection. Dates are exported as unambiguous ISO timestamps. **Print Analytics** opens browser printing; choose Save as PDF. Print CSS removes navigation and controls and resizes charts. Use a normal browser if an embedded preview does not expose a print dialog.

Date grouping uses the timezone exported from the laptop, so family members in another timezone see the same calendar. Optionally set `JOB_AGENT_TIME_ZONE=Asia/Kolkata` in the environment before starting the app/exporter. The public browser's clock determines today in that timezone, but only published records are available. Counts can lag local edits until the next publication. Weeks start Monday; the weekly change compares the same weekdays of this and the previous week, alongside the previous full-week total. Zero baselines show no percentage. A streak is active through today if there was activity today or yesterday. Unknown/future application dates do not create activity. An active-day average excludes days with zero applications.

Application analytics count each canonical opportunity once using its earliest recorded application date. Repeated status changes do not count as new applications. Original application/interview timestamps survive all subsequent status changes, including rejection, offer, withdrawal, saving or ignoring. Migration `004_preserve_application_history.sql` recovers dates cleared by V0.2 when genuine events exist; it never invents missing dates. The pre-upgrade backup is `data/opportunities.pre-v03.sqlite`. Incorrect historical application records require a deliberate correction in a future release; moving back to New does not erase them.

Interviews/offers count recorded evidence of reaching that stage, even after later outcomes. Rejection and status distributions reflect current status. An offer does not invent an interview. Sources are attributed once per application using the canonical URL, not every duplicate reference. Named preferred cities take precedence over Remote India, with unclassified places under Other. Discovered is the aggregate count of deduplicated private records, including filtered jobs; those private records are not exported. Match-score comparisons use current scores, require at least five applications and are descriptive rather than causal. Older snapshots without the new metadata remain readable.

The public contract adds only timezone, the discovered aggregate, remote type and allowlisted status/timestamp events. Private feedback/reasons and source payloads remain excluded. Charts use tree-shaken Chart.js bar components with accessible data tables; there is no external analytics service.

## Dashboard commands

```powershell
npm install
npm run dev             # editable dashboard: http://127.0.0.1:5173
npm run export-public   # sanitized public/data/jobs.json
npm run build           # static files in dist/
npm run preview         # read-only production preview on port 4173
npm run publish         # export, commit only jobs.json, push upstream
npm run sync            # discovery, database update, export and publish
```

The feed tabs show current stages: Opportunities, Applied (including later outcomes) and Interviews. Apply opens the original employer/project link. Mark Applied records `appliedAt`; Mark Interview records when the interview stage began, not a scheduled meeting time. Repeating a stage preserves its date. Legacy application dates remain unknown. Tracked applications remain visible even after a listing closes or stops matching. The local status selector supports Rejected, Offer and Withdrawn; history retains earlier stage dates.

The editable dashboard uses loopback-only Vite development middleware with same-origin checks and the existing SQLite database. Production and `npm run preview` are read-only, including when preview runs on localhost. The static build has no local API, SQLite or Git code. `OpportunityRepository` separates UI from storage: `LocalHttpRepository` supports local editing and `PublicJsonRepository` reads the published snapshot.

`PublicExportService` selects explicit safe fields. Profiles, resumes, raw source payloads, private notes, answers and salary expectations are never exported. Descriptions are shortened and contact details redacted; application links use HTTP(S) with unrecognized query parameters removed. Build validation permits only `public/data/jobs.json` in the public directory and rejects unexpected JSON fields. Keep private files in ignored `data/` and private configuration. Exported progress is intentionally visible to anyone with the public URL.

### One-time GitHub and Vercel setup

Publishing requires this folder to be a Git repository with committed dashboard code and an upstream branch. Use your personal GitHub repository and existing local Git authentication:

```powershell
git init -b main
npm run export-public
git add .gitignore .vercelignore README.md package.json pnpm-lock.yaml tsconfig.json vite.config.ts vite.local.config.ts vercel.json job-agent.cmd scripts src shared web migrations test public config/profile.example.json config/sources.example.json config/skills.json config/role-families.json config/domains.json
git diff --cached --stat
git commit -m "Add JobHunter V0.2 dashboard"
git remote add origin <YOUR_GITHUB_REPOSITORY_URL>
git push -u origin main
```

For an existing repository, retain its branch and remote instead of repeating initialization. Connect the repository through Vercel's Git integration. Settings: repository root, **Vite**, build **npm run build**, output **dist**, Node **24.x**. `vercel.json` supplies static build settings. Cloud builds read committed JSON and never run discovery or open SQLite. Personal use can run on [Vercel Hobby](https://vercel.com/docs/plans/hobby), with no mandatory paid services.

After setup, use **Publish Dashboard** locally or `npm run publish`. Only jobs.json is committed; unrelated staged changes are preserved. Publishing blocks tracked private files and private files in unpushed commits. Commit application code separately. Git uses your existing authentication; configure identity and sign in outside JobHunter. A failed push leaves the local commit for retry and never force-pushes. Vercel redeploys through its Git integration. `sync` stops publication if every attempted discovery source fails; partial failures remain visible in discovery reports.

Changes stay local until publication. The public site shows the last snapshot, including freshness as of export, with original posted dates and publication date displayed. There is no background synchronization or production API.

## Start on Windows

```powershell
cd D:\JobFinder
.\job-agent.cmd init
.\job-agent.cmd search
.\job-agent.cmd list
.\job-agent.cmd list recent
.\job-agent.cmd sources
```

The launcher selects Node 24+ from your current Node, `JOB_AGENT_NODE`, or the existing Codex runtime. It does not modify your system Node installation. If no compatible runtime exists, install Node 24+, reopen the terminal, and retry. `ERR_UNKNOWN_FILE_EXTENSION` from `node src/cli.ts` means the terminal's Node lacks TypeScript support; use the launcher. The portable equivalent is `node scripts/run.cjs list`. The CLI uses Node built-ins; install dependencies for the dashboard.

Development-only tools:

```powershell
npm install
npm run db:init
npm run cli -- list
npm run discover
npm run feed
npm run typecheck
npm test
```

`pnpm install --frozen-lockfile` uses the included development dependency lockfile. All npm CLI scripts use the compatible-runtime launcher. Node 24 is still the supported application runtime.

## Profile and resume

Edit `config/profile.json`. First initialization copies the example if the file does not exist. The example is illustrative, **not a factual resume**. Personal profile and resume evidence remain local and git-ignored. Extract only factual resume evidence; never commit the resume or personal configuration.

Fields include target/related titles, skills, strong/secondary skills, experience, acceptable types, exclusions, budget preferences and minimum match. Optional `coreSkillGroups` specifies alternative coherent stacks, for example `[["PHP","Laravel"],["C#",".NET"]]` **only when supported by your experience**. Without it, `strongSkills` is the core stack. `roleFamilies` optionally selects entries in `config/role-families.json`; otherwise they are derived from your configured titles. Optional `resumeEvidence` can record the source filename, extraction time and factual supporting statements after resume review.

`indiaFirst: true` applies this order: Mumbai/Navi Mumbai (including Thane), Bengaluru/Bangalore, Pune, Hyderabad, Remote India, other recognized Indian locations. Known city aliases are centralized in `src/matching/location.ts`. Expand that dictionary for missing cities. Explicit foreign residency restrictions block eligibility. International employment needs explicit India eligibility; “remote”, “APAC” or “worldwide” alone is insufficient. Worldwide freelance projects are allowed unless their description imposes a conflicting restriction. These are conservative text rules, not legal/work-authorization determinations. Unknown locations remain stored and visible with `list all`.

India-first rules supersede the old `strictLocation` matching. Setting `indiaFirst: false` restores the old preferred-location behavior. Empty `acceptableEmploymentTypes` permits all employment types. Exclusions are hard rules. `experienceMin`/`experienceMax` bound acceptable advertised experience; null disables either bound. Unknown experience stays visible. No numeric experience is invented from titles, although staff/principal/architect/director titles receive an explained penalty for profiles below six years.

## Commands

```powershell
.\job-agent.cmd list [fresh|recent|freelance|jobs|saved|all] --limit 30
.\job-agent.cmd show <id-prefix>
.\job-agent.cmd open <id-prefix>
.\job-agent.cmd save <id-prefix>
.\job-agent.cmd ignore <id-prefix> "wrong stack"
.\job-agent.cmd applied <id-prefix>
.\job-agent.cmd stats
.\job-agent.cmd sources
.\job-agent.cmd web-plan --limit 33 --offset 0
.\job-agent.cmd web-plan --domain naukri.com --limit 12
.\job-agent.cmd import path\to\confirmed-listings.json
```

`fresh` means known posting/publication date under 24 hours; `recent` means under 3 days. `list all` includes filtered opportunities for inspection. `open` launches the canonical URL; it never fills or submits anything and preserves saved/applied/ignored status. Ignore reasons: `wrong stack`, `too senior`, `too junior`, `location`, `compensation`, `company`, `not interested`, `duplicate`, `other`. `save` restores an ignored item while preserving historical feedback. `APPLIED` is manual.

## Source coverage — no inflated support counts

`config/sources.json` is the editable live company/feed registry. The example now has **19 enabled sources**, using eight network adapter mechanisms, plus a disabled local JSON import:

| Adapter | Configured coverage | Limits |
| --- | --- | --- |
| Greenhouse | GitLab, Groww, Clearwater, Eltropy, Epic Kids, Storable India | Public company boards; updated date is not posting date |
| Lever | Palantir, Meesho, Smart Working Solutions | Public boards; no reliable posting date supplied |
| Ashby | Ashby, Sarvam | Last-published date may be a republication |
| SmartRecruiters | Freshworks, Nagarro, Bosch | India-filtered pagination; software-title detail candidates; bounded details |
| Remotive | Software category public feed | Provider delays listings 24h; six-hour cache |
| Jobicy | Latest 100 remote listings | Partial recent feed; one-hour cache |
| Himalayas | India-only searches for up to three profile strong skills | First page per query; daily cache |
| Company page | Provis Technologies and CodeClouds Laravel pages | Configured public JobPosting JSON-LD pages only; robots checked; no crawling or JavaScript execution |
| JSON import | Any manually confirmed opportunity, including freelance | Disabled until you supply a real import file |

Some successful sources contribute **zero** matches; this is reported honestly. One failed source does not stop the others. `sources` shows the latest recorded result, including raw/new/known/merged/invalid counts, relevant retained opportunities and partial-coverage notes. `working` means the endpoint completed its configured retrieval, not that it supplied a good match. `partial` means limits or individual record errors reduced coverage. `failed` means that run failed. `unverified` means no run has tested it. Source state can change with time.

SmartRecruiters defaults to at most six listing pages and 25 detail pages; entries can override `maxPages` and `maxDetails`. Recent candidates come before older ones, with core skill/title terms preferred within the age tier. Caps are disclosed, not presented as exhaustive coverage. Nontechnical roles are skipped before details are fetched. Company-page sources fetch robots first and fail closed on errors, disallowed paths or redirects.

Public API documentation: [Greenhouse](https://docs.greenhouse.io/job-board.html), [Lever](https://github.com/lever/postings-api), [Ashby](https://developers.ashbyhq.com/docs/public-job-posting-api), [SmartRecruiters](https://developers.smartrecruiters.com/docs/endpoints), [Remotive](https://github.com/remotive-io/remote-jobs-api), [Jobicy](https://github.com/Jobicy/remote-jobs-api), [Himalayas](https://himalayas.app/docs/remote-jobs-api). Feed source names and backlinks remain visible in CLI output.

## Domain-targeted discovery

`config/domains.json` contains **33 configurable domains/paths**: Naukri, LinkedIn Jobs, Indeed India, Wellfound, Cutshort, Instahyre, Foundit, Hirist, Shine, TimesJobs, Internshala, ATS domains, Workday, company careers, Upwork, Freelancer, PeoplePerHour and public feeds.

**Naukri, LinkedIn, Indeed, Wellfound, Cutshort, Instahyre, Foundit, Hirist, Shine, TimesJobs, Internshala, Workday, Upwork and Freelancer are discovery-only, not automatic scraping adapters.** No authenticated sessions, CAPTCHA bypasses or paid search APIs are included. Bing RSS was evaluated but not integrated: its crawl policy excludes search, and the tested feed did not reliably respect the domain query. Search URLs are not reported as ingested opportunities.

`search` prepares a bounded batch of profile/title/skill/location/domain combinations alongside automatic API discovery. `web-plan` also generates these on demand. Role and city combinations vary across domains, with Mumbai/Navi Mumbai and Bengaluru/Bangalore aliases grouped to avoid redundant queries. Query hashes are persisted; subsequent scans advance through the plan. Use `--offset` for explicit batches; `--limit` is capped at 200. Outputs:

- `data/web-discovery.html`: simple browser links; no frontend app or server.
- `data/web-queries.json`: reusable query records.

Open selected searches in your browser. The search engine's past-week filter is a discovery hint, **never evidence of the job's posting date**. To bring confirmed listings back, use `import` with a RawOpportunity array, saved HTML containing JobPosting JSON-LD, or standalone JobPosting JSON-LD. Imports retain source domains, URLs, source dates and identifiers for deduplication. Search snippets alone are rejected. There is no general automatic search-engine ingestion in this release.

Company-page adapters can be added for permitted public URLs with JobPosting JSON-LD. They do not infer jobs from arbitrary HTML. Add employer ATS board identifiers discovered through search to the normal registry for future direct API retrieval. Automatic ATS registration is not implemented.

## Matching and freshness

Deterministic skill aliases live in `config/skills.json`; role title families and primary stack anchors live in `config/role-families.json`. Employment match uses 40% core coverage, 15% weighted profile skill coverage, 15% role compatibility, 10% experience and 20% location, with up to five keyword points. Freelance independently uses 45% core, 20% skills, 15% scope, 10% comparable budget and 10% location.

Zero core-stack evidence caps match below the default 25-point cutoff. An explicit unsupported primary technology in the title or a recognized required-skill phrase also caps it below 25. This stops Java/Spring/PostgreSQL/REST from ranking like PHP/Laravel/PostgreSQL/REST. Unrelated employment role families are similarly capped. Partial primary-stack matches are still possible and explained. Core strengths are only as accurate as your profile. These are heuristic scores, not probabilities; required/preferred/negated language is not universally understood.

Freshness buckets: under 6h, under 24h, under 72h, under 8 days, older. `postedAt`, `updatedAt`, `firstSeenAt`, `lastSeenAt`, and `discoveredAt` remain separate. Unknown posting dates display “New to us — posting date unknown”. Date-only postings never claim “Just Posted”; source last-publication dates are labeled. Unzoned feed timestamps are conservatively unknown. Never substitute a crawl/update time for a posting time.

Rank multiplies fit by a freshness factor: employment `match × (0.35 + 0.65 × freshness/100)`, freelance `match × (0.30 + 0.70 × freshness/100)`. Freshness decays over a three-day scale. Unknown dates receive at most eight freshness points from our own observation, with explicit unknown labeling. Additional rank multipliers of 0.35 after 30 days and 0.1 after 90 days suppress stale listings. A feed cannot promise new relevant openings when sources do not contain them; use `list fresh` or `list recent` to see only known recent dates.

Freelance remains a separate feed/strategy. Only matching currency and budget units are compared; no exchange conversion or hourly/project guessing. International projects must explicitly permit worldwide or Indian participation. Live Upwork/Freelancer ingestion is not claimed; their discovery links and confirmed imports are supported.

## Persistence, deduplication and reliability

The existing database upgrades transactionally through `migrations/003_application_progress.sql`; no reset is needed. A pre-upgrade database copy was saved locally as `data/opportunities.pre-v01.sqlite` during development. Normalized opportunity fields and source references remain relational. Raw payloads, nested profile configuration and run diagnostics remain JSON where appropriate. Scores are recalculated at read time.

Deduplication uses source-scoped external IDs, canonical URL equivalence (including ATS application URL variants), employer requisition IDs scoped by normalized company, and conservative company/title/location/description similarity. Company suffixes and Bangalore/Bengaluru aliases are normalized. Distinct known requisitions are not fuzzy-merged. Fuzzy title Jaccard >=0.8 and description Jaccard >=0.75 with at least 20 unique words are required; known posting dates over a week apart do not fuzzy-merge. Ambiguous cases stay separate.

All source references survive merges. Employer URLs outrank aggregators/imports, first-seen time and user status survive, and the most authoritative record supplies matching skills. Later canonical evidence can consolidate existing rows without losing references. Raw copies retain their original data. Posting dates from the most authoritative dated source are preferred; rediscovery does not refresh an old posted date. Perfect cross-portal deduplication cannot be guaranteed for rewritten descriptions or missing employer identifiers.

Network calls are sequential, normally one second apart, with 20-second timeouts and at most two retries for network/429/5xx errors. Responses are cached per provider. A long Retry-After stops that source for the run rather than retrying early. Authentication errors are not retried. There is no background service; run manually or schedule at a modest interval in Windows Task Scheduler with this project as the working directory.

Run incoming counters are separate from whole-feed totals. Relevant source contribution counts represent retained canonical opportunities linked to that source; they can overlap across sources and include earlier runs. A source disappearing does not automatically mark all its previous jobs closed. Imported `closed: true` or JSON-LD `validThrough` can mark explicit closures. Verify current availability on the canonical page.

Data defaults to `data/opportunities.sqlite`, with WAL and a busy timeout. Set `$env:JOB_AGENT_DATA` to relocate it. `.env` is not automatically loaded. Back up the data directory with the application stopped. Personal configuration, caches and databases are git-ignored. No API keys are needed.

## Architecture and verification

The existing modules remain: `sources/`, `normalization/`, `persistence/`, `matching/`, `discovery/`, profile/config and CLI. New location/role rules, structured public adapters, JSON-LD extraction and dedup rules are small modules behind the existing interfaces. The CLI is preserved. web/ contains the dashboard, shared/ the public contract, src/local/ the development-only editor, src/export/ the public boundary and src/publishing/ the local Git workflow.

Tests cover source failure isolation, migration from V0, repeated discovery, source/status preservation, four-portal merging, late canonical collision resolution, India geography, core-stack mismatches, stale dates, freelance imports, bounded search generation and robots-aware company extraction. Public source availability and the age of real listings vary independently of fixture tests.

No auto-applying, browser form automation, resume/cover-letter generation or AI providers have been added. AI-related skills in the resume are candidate facts only; the application itself still uses no AI.

