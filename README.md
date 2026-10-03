# JobFinder V0.6 — Application Assistant

India-first discovery and explainable ranking with a small React dashboard and private SQLite database. Local, CPU-only; no AI, hosted database, or automatic applications.

## Expanded analytics and discovery

Open **Calendar / History** for the monthly calendar. **Analytics** is organized into Overview, Activity, What I’m Applying To, What’s Working and Funnel. It includes 7D/30D/90D/All application line charts, a daily heatmap with selectable dates, cumulative applications/interviews, skill counts and interview-rate toggles, role/source/location cohorts, score and freshness-at-application cohorts, current statuses and stage totals. The feed keeps a compact line chart and status summary. Everything runs client-side from sanitized JSON; Vercel stays static and read-only.

**Export CSV** downloads all tracked applications, independent of the current feed filter. Files use UTF-8 BOM, CRLF, quoted fields and Excel formula-injection protection. Dates are exported as unambiguous ISO timestamps. **Print Analytics** opens browser printing; choose Save as PDF. Print CSS removes navigation and controls and resizes charts. Use a normal browser if an embedded preview does not expose a print dialog.

Date grouping uses the timezone exported from the laptop, so family members in another timezone see the same calendar. Optionally set `JOB_AGENT_TIME_ZONE=Asia/Kolkata` in the environment before starting the app/exporter. The public browser's clock determines today in that timezone, but only published records are available. Counts can lag local edits until the next publication. Weeks start Monday; the weekly change compares the same weekdays of this and the previous week, alongside the previous full-week total. Zero baselines show no percentage. A streak is active through today if there was activity today or yesterday. Unknown/future application dates do not create activity. An active-day average excludes days with zero applications.

Application analytics count each canonical opportunity once using its earliest recorded application date. Repeated status changes do not count as new applications. Original application/interview timestamps survive all subsequent status changes, including rejection, offer, withdrawal, saving or ignoring. Migration `004_preserve_application_history.sql` recovers dates cleared by V0.2 when genuine events exist; it never invents missing dates. The pre-upgrade backup is `data/opportunities.pre-v03.sqlite`. Incorrect historical application records require a deliberate correction in a future release; moving back to New does not erase them.

Interviews/offers count recorded evidence of reaching that stage, even after later outcomes. Rejection and status distributions reflect current status. An offer does not invent an interview. Sources are attributed once per application using the canonical URL, not every duplicate reference. Named preferred cities take precedence over Remote India, with unclassified places under Other. Discovered is the aggregate count of deduplicated private records, including filtered jobs; those private records are not exported. New applications freeze score, recognized job skills and source posting-date evidence through migration 005. Older applications use current listing data with an explicit estimate label; no historical facts are invented. Skill cohorts offer a minimum sample selector; all rates show denominators and warn on samples below five. Comparisons are descriptive rather than causal. Older snapshots without the new metadata remain readable.

The public contract includes timezone, the discovered aggregate, remote scope, recognized job skills/role families, allowlisted application-time facts and status/timestamp events. Private feedback/reasons and source payloads remain excluded. Charts use tree-shaken Chart.js line and bar components with accessible data tables; there is no external analytics service.

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

`indiaFirst: true` applies this order: Mumbai/Navi Mumbai (including Thane), Bengaluru/Bangalore, Pune, Hyderabad, Remote India, other recognized Indian locations. Known city aliases are centralized in `src/matching/location.ts`. Expand that dictionary for missing cities. Explicit foreign residency restrictions block eligibility. International employment needs explicit India eligibility or a worldwide/broad Asia/APAC remote scope; “remote” without geography is insufficient. Worldwide freelance projects are allowed unless their description imposes a conflicting restriction. These are conservative text rules, not legal/work-authorization determinations. Unknown locations remain stored and visible with `list all`.

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

`config/sources.json` is the editable live company/feed registry. The example now has **39 enabled sources**, using eight network adapter mechanisms, plus a disabled local JSON import:

| Adapter | Configured coverage | Limits |
| --- | --- | --- |
| Greenhouse | 13 boards including GitLab, Groww, Clearwater, Blenheim Chalcot India, Prodigal, SonicWall, DevRev and Amtech | Public company boards; updated date is not posting date |
| Lever | 10 boards including Meesho, Smart Working, Acceldata, Saviynt, SAFE, Gushwork, Level AI and Weekday | Public boards; no reliable posting date supplied |
| Ashby | 8 boards including Sarvam, Confluent, Emergence, Socure and FurtherAI | Last-published date may be a republication |
| SmartRecruiters | Freshworks, Nagarro, Bosch | India-filtered pagination; software-title detail candidates; bounded details |
| Remotive | Software category public feed | Provider delays listings 24h; six-hour cache |
| Jobicy | Latest 100 remote listings | Partial recent feed; one-hour cache |
| Himalayas | India plus worldwide searches for up to eight profile skills/titles | Up to four pages per query; daily cache; repeated-page detection |
| Company page | Provis Technologies and CodeClouds Laravel pages | Configured public JobPosting JSON-LD pages only; robots checked; no crawling or JavaScript execution |
| JSON import | Any manually confirmed opportunity, including freelance | Disabled until you supply a real import file |

Some successful sources contribute **zero** matches; this is reported honestly. One failed source does not stop the others. `sources` shows the latest recorded result, including raw/new/known/merged/invalid counts, relevant retained opportunities and partial-coverage notes. `working` means the endpoint completed its configured retrieval, not that it supplied a good match. `partial` means limits or individual record errors reduced coverage. `failed` means that run failed. `unverified` means no run has tested it. Source state can change with time.

SmartRecruiters defaults to at most six listing pages and 25 detail pages; entries override `maxPages`, `maxDetails` and `detailOffset`. The provided registry uses 12 listing pages and 60/120/100 details for Freshworks/Nagarro/Bosch. Use a later detailOffset to inspect additional candidates. Recent candidates come before older ones, with core skill/title terms preferred within the age tier. Caps are disclosed, not presented as exhaustive coverage. Nontechnical roles are skipped before details are fetched. Company-page sources fetch robots first and fail closed on errors, disallowed paths or redirects.

Public API documentation: [Greenhouse](https://docs.greenhouse.io/job-board.html), [Lever](https://github.com/lever/postings-api), [Ashby](https://developers.ashbyhq.com/docs/public-job-posting-api), [SmartRecruiters](https://developers.smartrecruiters.com/docs/endpoints), [Remotive](https://github.com/remotive-io/remote-jobs-api), [Jobicy](https://github.com/Jobicy/remote-jobs-api), [Himalayas](https://himalayas.app/docs/remote-jobs-api). Feed source names and backlinks remain visible in CLI output.

## Domain-targeted discovery

`config/domains.json` contains **87 configurable domains/paths**: Naukri, LinkedIn Jobs, Indeed India, Wellfound, Cutshort, Instahyre, Foundit, Hirist, Shine, TimesJobs, Internshala, ATS domains, Workday, company careers, Upwork, Freelancer, PeoplePerHour and public feeds.

**Search-only domains are targets, not a claim of working portal adapters.** Naukri, LinkedIn, Indeed, Wellfound, Cutshort, Instahyre, Foundit, Hirist, Shine, TimesJobs, Internshala, Workday, Upwork and Freelancer can receive profile-generated searches through the provider below. A result counts as an opportunity only after successful public JobPosting/ATS extraction. Authentication, robots exclusions, challenges and unsupported pages are reported, never bypassed. Direct structured adapters continue operating independently.

`search` runs automatic web discovery alongside direct API discovery. `web-plan` is an optional manual browser-link generator, separate from the normal workflow. Role and city combinations vary across domains, with separate Mumbai/Navi Mumbai searches and grouped Bengaluru/Bangalore aliases. For the optional plan, use `--offset` for explicit batches; `--limit` is capped at 200. Its outputs are:

- `data/web-discovery.html`: simple browser links; no frontend app or server.
- `data/web-queries.json`: reusable query records.

Open selected searches in your browser. Queries no longer force a past-week search restriction or quote whole role titles. Search recency is never evidence of the posting date. These manual search links are separate from the automated provider query budget. `import` still accepts confirmed RawOpportunity arrays or saved JobPosting HTML/JSON-LD. The new `search-web` command accepts candidate URLs and fetches/validates them instead; snippets alone are rejected.

Verified Greenhouse, Lever, Ashby and SmartRecruiters boards discovered through search are automatically appended to private `config/sources.json`. Public pages outside known portal domains with valid JobPosting data can also register as company-page sources. Existing entries and disabled settings are preserved. Registration follows successful extraction, never a snippet or a guessed employer. New entries join direct discovery on the next run. A generic careers landing page without JobPosting data contributes no job; recognized visible ATS links are inspected within the same candidate budget.

### Search provider setup

**Run `npm run discover`. Automatic web search is enabled by default through Tavily's official keyless API.** JobHunter generates queries, searches, obtains URLs, validates public listings and sends them through the existing SQLite pipeline. You do not supply URLs or create an account. No API key, credit card, paid fallback or LLM answers are used. The [official Tavily CLI](https://github.com/tavily-ai/tavily-cli) and [official SDK](https://github.com/tavily-ai/tavily-python/blob/master/tavily/tavily.py) document this supported keyless access. It is fair-use limited, not unlimited or guaranteed available.

No config file is required. If you previously created `config/search.json` with `provider: "none"` or `"saved-results"`, change it to `"tavily"` to enable automatic discovery. `none` remains an explicit opt-out. Other providers remain replaceable:

- **SearXNG:** a JSON endpoint you operate or have permission to query. The [documented search API](https://docs.searxng.org/dev/search_api.html) supports JSON and pagination, but many public instances disable JSON. JobHunter does not pick random instances or switch endpoints after blocking.
- **Mwmbl (experimental):** its public [search API implementation](https://github.com/mwmbl/mwmbl/blob/main/mwmbl/tinysearchengine/search.py) supports no-key queries. This independent index may have limited job coverage. The live request from this laptop timed out; this is not claimed as a verified reliable provider. Honor its [terms](https://mwmbl.org/terms); no HTML search scraping or paid tier is used.
- **Saved results:** optional debugging/import path only; not the normal discovery workflow.

To override budgets/provider, copy `config/search.example.json` to ignored `config/search.json`. For SearXNG set `provider` to `searxng`, `endpoint` to your instance's full `/search` URL and `permissionConfirmed` to `true`. JSON output must be enabled by the instance operator. HTTPS is required except for a local loopback endpoint. For experimental Mwmbl, set `provider` to `mwmbl`; no key is needed.

```powershell
# Normal workflow: direct sources plus automatic web discovery:
npm run discover
# Automatic web search only, without rerunning direct sources:
npm run cli -- search-web
# Latest provider/query/candidate/domain report:
npm run cli -- search-report
```

`config/search-results.example.json` shows the saved batch format: `queries` containing `query`, optional `domain`, and `results` with `url` and optional `title`. The example deliberately contains no fake opportunities. Keep actual query/result batches under ignored `data/`. A title/snippet is never used as substitute job content. Duplicate query entries are rejected; combine their results into one batch.

The provider-independent `QueryGenerator` uses profile titles, related role families, strong skills, Indian cities and India/worldwide/APAC/Asia remote searches. It rotates across the extensible `config/domains.json` registry and adds unrestricted careers/apply queries. Defaults per run: 20 queries (4 open-web), 10 results/query and 40 candidate fetches. Tavily has no pagination parameter, so each query makes at most one request; the two-page setting applies only to providers with pagination. Configure these bounded budgets in `config/search.json`. The automated cursor is separate from the manual web-plan cursor. Result limits and repeated pages are reported. After a provider failure, the domain cursor advances only past targeted queries that actually completed. A provider failure stops further search requests in that run while allowing direct sources to complete.

Candidate processing deduplicates normalized URLs, checks domain scopes, blocks private/LAN addresses, consults robots policy for generic pages and validates usable JobPosting JSON-LD or recognized public ATS data. Narrowly verified metadata-only fallbacks are explicitly marked partial and counted separately. Public category pages can supply up to ten same-site candidate URLs through schema.org ItemList; these are independently fetched and validated, not counted as jobs. Linked listings enter the same persistent, domain-fair queue as other candidates. ItemList expansion occurs only on original search results, and ATS links are bounded to two hops, within the total candidate budget. No portal internal-search calls, login automation, JavaScript execution or arbitrary redirects are used. Cross-domain ATS canonical claims are verified through the ATS before taking precedence. Unsupported pages remain unextracted. Validated results enter the existing India-eligibility, skill matching, freshness and cross-source deduplication pipeline. Posted dates come from listings, never search-engine snippets or discovery time.

Search URLs, titles and public snippets are cached for a day, generic pages for six hours and robots policies for a day. Uncached requests are spaced by at least 1.5 seconds per transport; denied/rate-limited candidate hosts stop for that run. Requests have a timeout; candidate responses have a 5 MB cap. Tavily keyless caps stop further requests; its retry-after interval is persisted across runs (a conservative day when none is given). No proxy rotation, alternate identity, account-key usage, paid fallback or attempts to bypass a cap. Direct sources continue. Deferred URLs persist in the private SQLite candidate queue and resume automatically on later runs. Completed and blocked URLs do not repeatedly consume the inspection budget; transient failures have bounded backoff.

Reports separate direct-source opportunities, returned/unique candidate URLs, extracted jobs, inaccessible/unsupported/deferred pages, duplicates, registered sources, location exclusions and final relevant canonical jobs. Per-domain extraction counts and per-domain matching funnels let you verify actual contributions. Counts across domains can overlap after a cross-portal merge. `runPipeline` describes this run; `storedPipeline` describes all stored jobs. Query text, candidate audits, provider configuration and raw pages remain private and are never included in public JSON.

Search availability does not guarantee extractability: LinkedIn's robots policy blocked its candidate page in validation. Other portals may require login, disallow access or omit structured data. Blocked pages contribute zero page-validated opportunities; a narrowly verified metadata-only partial record may be retained and is counted separately. JobHunter never fabricates portal support or imports snippets as complete jobs. Only role/skill/location/domain queries are sent to the provider, not the resume, contact details, application history or SQLite database.

Live validation on 2026-10-02, using automatically generated queries and no supplied URLs: 20 searches returned 162 URLs. After URL deduplication and structured listing-link expansion there were 173 candidates. The bounded scan inspected 40, extracted 119 job records from 21 pages/boards and retained 11 relevant opportunities (7 Cutshort, 4 Internshala). One new Ashby board was registered; its 99 jobs were excluded for location eligibility. There were 13 inaccessible URLs, 6 pages without a validated job and 133 deferred candidates. The direct sources independently returned 2,250 records. These are observed results, not guaranteed future yields; search-only domains with no validated contribution remain visible as zero.

### Why this provider (investigated October 2026)

| Mechanism | Assessment for this laptop |
| --- | --- |
| Tavily keyless API | Chosen after successful live job-query tests. Official anonymous automated access, no credentials/billing; fair-use cap and no pagination. |
| Tavily free account | [1,000 recurring credits/month, no card](https://www.tavily.com/pricing). An alternative requiring account setup; not used by the default keyless provider. |
| Exa free account | [Recurring free credits, no payment method](https://exa.ai/pricing). Viable alternative with setup; not implemented or live-tested here. |
| Local/public SearXNG | Local software is free but delegates to upstream engines and their access restrictions. Public JSON is often disabled; needs a permitted endpoint and maintenance. [API docs](https://docs.searxng.org/dev/search_api.html). |
| Mwmbl | Open independent index; optional adapter retained. Prior laptop request timed out, so not selected as the default. |
| DuckDuckGo HTML/lite scraping | Those routes are [disallowed by its robots policy](https://duckduckgo.com/robots.txt). No scraper implemented. |
| Brave API | [Requires a card for plan activation](https://api-dashboard.search.brave.com/documentation/resources/help-feedback), despite included credits; not selected. |
| Common Crawl/local index | [Crawl archive and URL indexes](https://commoncrawl.org/get-started), not a ready fresh job-search engine. Building a useful local full-text index is disproportionate for this laptop. |

## Matching and freshness

Deterministic skill aliases live in `config/skills.json`; role title families and primary stack anchors live in `config/role-families.json`. Employment match uses 40% core coverage, 15% weighted profile skill coverage, 15% role compatibility, 10% experience and 20% location, with up to five keyword points. Freelance independently uses 45% core, 20% skills, 15% scope, 10% comparable budget and 10% location.

Zero core-stack evidence caps match below the default 25-point cutoff. An explicit unsupported primary technology in the title or a recognized required-skill phrase also caps it below 25. This stops Java/Spring/PostgreSQL/REST from ranking like PHP/Laravel/PostgreSQL/REST. Unrelated employment role families are similarly capped. Partial primary-stack matches are still possible and explained. Core strengths are only as accurate as your profile. These are heuristic scores, not probabilities; required/preferred/negated language is not universally understood.

Freshness buckets: under 6h, under 24h, under 72h, under 8 days, older. `postedAt`, `updatedAt`, `firstSeenAt`, `lastSeenAt`, and `discoveredAt` remain separate. Unknown posting dates display “New to us — posting date unknown”. Date-only postings never claim “Just Posted”; source last-publication dates are labeled. Unzoned feed timestamps are conservatively unknown. Never substitute a crawl/update time for a posting time.

Rank multiplies fit by a freshness factor: employment `match × (0.35 + 0.65 × freshness/100)`, freelance `match × (0.30 + 0.70 × freshness/100)`. Freshness decays over a three-day scale. Unknown dates receive at most eight freshness points from our own observation, with explicit unknown labeling. Additional rank multipliers of 0.35 after 30 days and 0.1 after 90 days suppress stale listings. A feed cannot promise new relevant openings when sources do not contain them; use `list fresh` or `list recent` to see only known recent dates.

Freelance remains a separate feed/strategy. Only matching currency and budget units are compared; no exchange conversion or hourly/project guessing. International projects must explicitly permit worldwide or Indian participation. Live Upwork/Freelancer ingestion is not claimed; their discovery links and confirmed imports are supported.

## Persistence, deduplication and reliability

The existing database upgrades transactionally through `migrations/007_job_intelligence.sql`; no reset is needed. A pre-upgrade database copy was saved locally as `data/opportunities.pre-v01.sqlite` during development. Normalized opportunity fields and source references remain relational. Raw payloads, nested profile configuration and run diagnostics remain JSON where appropriate. Scores are recalculated at read time.

Deduplication uses source-scoped external IDs, canonical URL equivalence (including ATS application URL variants), employer requisition IDs scoped by normalized company, and conservative company/title/location/description similarity. Company suffixes and Bangalore/Bengaluru aliases are normalized. Distinct known requisitions are not fuzzy-merged. Fuzzy title Jaccard >=0.8 and description Jaccard >=0.75 with at least 20 unique words are required; known posting dates over a week apart do not fuzzy-merge. Ambiguous cases stay separate.

All source references survive merges. Employer URLs outrank aggregators/imports, first-seen time and user status survive, and the most authoritative record supplies matching skills. Later canonical evidence can consolidate existing rows without losing references. Raw copies retain their original data. Posting dates from the most authoritative dated source are preferred; rediscovery does not refresh an old posted date. Perfect cross-portal deduplication cannot be guaranteed for rewritten descriptions or missing employer identifiers.

Network calls are sequential, normally one second apart, with 20-second timeouts and at most two retries for network/429/5xx errors. Responses are cached per provider. A long Retry-After stops that source for the run rather than retrying early. Authentication errors are not retried. There is no background service; run manually or schedule at a modest interval in Windows Task Scheduler with this project as the working directory.

Run incoming counters are separate from whole-feed totals. Relevant source contribution counts represent retained canonical opportunities linked to that source; they can overlap across sources and include earlier runs. A source disappearing does not automatically mark all its previous jobs closed. Imported `closed: true` or JSON-LD `validThrough` can mark explicit closures. Verify current availability on the canonical page.

Data defaults to `data/opportunities.sqlite`, with WAL and a busy timeout. Set `$env:JOB_AGENT_DATA` to relocate it. `.env` is not automatically loaded. Back up the data directory with the application stopped. Personal configuration, caches and databases are git-ignored. No API keys are needed.

## Architecture and verification

The existing modules remain: `sources/`, `normalization/`, `persistence/`, `matching/`, `discovery/`, profile/config and CLI. New location/role rules, structured public adapters, JSON-LD extraction and dedup rules are small modules behind the existing interfaces. The CLI is preserved. web/ contains the dashboard, shared/ the public contract, src/local/ the development-only editor, src/export/ the public boundary and src/publishing/ the local Git workflow.

Tests cover source failure isolation, migration from V0, repeated discovery, source/status preservation, four-portal merging, late canonical collision resolution, India geography, core-stack mismatches, stale dates, freelance imports, bounded search generation and robots-aware company extraction. Public source availability and the age of real listings vary independently of fixture tests.

No auto-applying, browser form automation, resume/cover-letter generation or AI providers have been added. AI-related skills in the resume are candidate facts only; the application itself still uses no AI.


## Discovery diagnostics and location filters

Run `npm run cli -- diagnostics` for configured/enabled sources, domain modes, prepared query count, per-source limits, hard-filter reasons, match threshold exclusions, unknown dates and stale counts. Discovery prints raw → unique → eligible → relevant counts and records the same funnel per source. Source contribution counts can overlap; whole-run canonical counts do not. Search plans default to two combinations per domain (174 currently), capped at 200 per batch, and use a local cursor so repeated queries cannot stall progression. Add domains to `config/domains.json` or company boards to private `config/sources.json`; no adapter changes are needed for another company on an existing ATS.

The October 1 validation scan received 2,241 records from 39 sources, with zero failed sources and six honestly reported partial sources. Its 2,239 unique touched records became 1,076 location/filter-eligible and 176 above the existing 25-point match threshold. The prior baseline was 52 relevant stored jobs from 19 enabled sources. The principal bottlenecks were SmartRecruiters detail caps, first-page-only Himalayas queries and exclusion of worldwide remote jobs. Deduplication and recency ranking were not the main blockers. These are observed run figures, not guaranteed future yield.

The dashboard location selector includes All, Mumbai, Navi Mumbai, Pune, Bengaluru, Hyderabad, Remote and Other India, plus Remote India and Global Remote. Bangalore is normalized to Bengaluru. Explicit worldwide or broad Asia/APAC remote eligibility is accepted unless the listing excludes India or states a foreign-only residency requirement. US/EU/UK/Canada-only roles remain excluded. An international company address alone does not make a role ineligible when it explicitly accepts India. Geography parsing is deterministic: ambiguous remote-only listings remain unconfirmed, and source classifications should be checked on the original listing.

## October 2 discovery recovery fixes

`npm run discover` still uses the same match threshold and bounded request budgets. Search candidates now persist privately in `data/search-queue.sqlite`, with PENDING, INSPECTED, BLOCKED, FAILED and RETRYABLE states. Runs resume pending work with domain fairness. Transient failures back off for one hour, then two hours, with three attempts maximum. Access denials and robots exclusions are terminal; they are not repeatedly retried. Successfully extracted payloads remain queued until ingestion acknowledges them. Existing deferred URLs from the last completed pre-queue run are recovered automatically.

Domain rotation advances by successfully executed domain queries, not the total query budget including open-web searches. Diagnostics show coverage in the current run and since rotation began. Tavily has no documented page cursor: `pagesPerQuery` does not fabricate pagination for this provider. Successive rotations vary profile-derived role/location queries instead. Wellfound discovery accepts `/jobs` and `/role` paths only for the Wellfound job scope.

Public-page redirects are bounded to five hops, DNS-pinned to public addresses and checked against destination robots rules. Diagnostics distinguish access denials, robots restrictions, security rejection, timeouts and unsupported pages. A metadata-only partial record is permitted only for a specific LinkedIn listing whose search metadata explicitly supplies employer, role and location, with supporting content. It is visibly prefixed PARTIAL and has no invented posting date. Generic snippets and query locations never become job facts.

SmartRecruiters persists unprocessed details and listing offsets. Himalayas saves page positions per query and rotates through all profile terms. Jobicy follows the API's opaque `nextCursor` with a bounded page budget and respects its expiry; missing pagination metadata is reported rather than invented. These private checkpoints live under the HTTP cache directory.

Unspecified remote geography remains eligible with a lower location score and an explanation to verify India eligibility. Explicit foreign-only restrictions remain excluded. Web Developer and Web Application Developer are recognized software titles; incompatible core stacks still cap matching scores. Source references retain employer requisition IDs, preventing an aggregator without an ID from merging different openings. Reconstructable historical SmartRecruiters conflicts are separated during discovery; existing application history stays on the original record.

Provider references: [Tavily search parameters](https://docs.tavily.com/documentation/api-reference/endpoint/search), [Jobicy cursor pagination and limits](https://jobicy.com/jobs-rss-feed). Provider availability and extraction success are measured per run, not implied by registry membership.


## V0.5 — discovery quality and job intelligence

Keep using `npm run discover`, `npm run dev`, `npm run export-public` and `npm run publish`. No new service, API key, model, or paid dependency is needed. Database migration 007 preserves application history and adds requirement evidence and lifecycle observations. The global match threshold is unchanged.

- **Recommended** is the normal feed. **New** shows recommended jobs first observed between the previous successful discovery run’s finish and the latest successful run’s finish (on the first successful run, its start is the boundary). Failed runs do not move this window. **All** locally includes low-scoring, filtered, ignored and closed untracked jobs for investigation. **Saved** retains bookmarks even if later filtered. Application-stage records remain in their existing tabs.
- Expand **Match details** or **Why wasn’t this recommended?** for required/preferred coverage, missing requirements, experience, location, major stack mismatches and exact exclusion reasons. Filters no longer discard the score explanation. The public export contains only sanitized dashboard fields; the local All inventory is not automatically published.
- Required/preferred skills are extracted from explicit words and section headings using the existing skill dictionary. Unclassified mentions remain unclassified. Education is extracted but **not scored** because no verified structured candidate education comparison exists. Role family, location, work mode and employment type remain part of the normalized model. Ambiguous or nonstandard phrasing may need review; a missing extracted requirement does not prove there is none.
- Where mandatory skills are explicit, fit combines 70% of the existing employment/freelance strategy with 25 points for required coverage and 5 for preferred coverage (required coverage substitutes when no preferred list exists). With only preferred skills, 5% uses preferred coverage. Existing primary-stack, role and seniority caps still apply. Freshness changes ranking separately; a score is a heuristic, not a probability.
- **HIGH / MEDIUM / LOW confidence** describes evidence quality, separately from compatibility. HIGH requires detailed employer evidence; short/incomplete descriptions reduce confidence. Search-metadata partials are always LOW and never invent posting dates. Full descriptions from aggregators cannot receive HIGH solely for being long.
- Availability is separate from application status: ACTIVE, POSSIBLY_CLOSED, CLOSED, STALE, INACCESSIBLE. Canonical explicit closure or matching expired JobPosting data can close a role. A canonical 404/410 needs repeated checks at least 24 hours apart. Other repeated failures mean INACCESSIBLE, not CLOSED. Discovery performs at most six robots-aware checks of employer listings unobserved for seven days, with a seven-day check cooldown. Thirty days without an observation marks a role STALE, not closed. Capped source batches never imply closure. CLOSED jobs disappear from Recommended/New but remain in local All/Saved and application history.
- Set optional `"dailyApplicationTarget": 10` at the top level of private `config/profile.json`, then refresh the local dashboard. Omit it to disable the target. The target is local-only; a streak still needs just one application that day.
- Analytics’ **Evidence worth reviewing** shows actual application/interview counts and rates for skills, role, source, location, score and freshness groups with **at least 10 applications**. These descriptive rates include pending applications and do not establish causation. Existing analytics and streak calculations are preserved.
- Discovery prints genuinely new records separately from recommended new jobs, strong matches (score >=75), posted-under-24h, remote and freelance counts. The latter counts apply to recommended new jobs. Source diagnostics retain query/domain/extraction/cap information. Persistent candidates, fair domain turns, source checkpoints and safe redirects remain in place. Changed search metadata and linking pages may be reconsidered after seven days; unchanged inspected job metadata remains terminal, and access blocks are never bypassed.

Private live audit logs and the database backup for this release are in `data/audit-v05-20261003/`. They are not part of the public build. New tests cover requirement gaps, confidence, rejection explanations, lifecycle evidence, new-run boundaries, queue refresh and analytics sample sizes.


## V0.6 — private application assistance

Load the **extension/** directory as an unpacked Chrome/Chromium extension and follow [the extension setup and workflow](extension/README.md). Run `npm run assistant:setup -- YOUR_EXTENSION_ID` to create the private profile and pairing secret, then keep `npm run dev` running. No discovery or publishing is part of this setup.

The extension detects native form controls on your click, fills only high-confidence blank fields, and lets you confirm other answers or optionally remember them. Choose/default a local resume variant and explicitly attach it. Navigate and submit the employer's form yourself; afterward choose **Mark Applied in JobFinder** to reuse existing tracking/history/streaks/analytics. Private application profile, reusable answers, and application sessions never enter the public export. The static Vercel dashboard and public schema are unchanged.

Migration 008 creates private answer/session tables; existing data and deduplication are retained. Pairing is loopback-only and restricted to your chosen extension ID plus a random secret. See the extension README for profile fields, resume paths, supported controls, multi-step behavior, and manual browser checks. No automatic submission, login, CAPTCHA handling, cloud service, or AI is included.
