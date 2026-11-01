# Wrong and Unsure Question CSVs: Instructions for LLMs

This folder holds saved Udemy practice-exam result pages (`*.html`, each with a `*_files` folder) for AWS DVA-C02. The owner adds more papers and attempts over time. Your job is to turn them into one CSV per test paper, listing every question the owner got wrong or marked as unsure.

Read this whole file before starting. Follow it exactly so that new CSVs match the existing ones.

## Non-negotiable rules

1. **Copy, never compose.** Every cell comes from the HTML by program. Do not type, summarise, paraphrase, translate or correct any question, answer, explanation or tip.
2. **Keep source errors.** If the source has a typo, keep it. For example, one explanation really does say "AWS AWS Key Management Service".
3. **Never fill a gap.** If something is not in the HTML, leave the cell blank and report it. Never write a keyword tip yourself.
4. **The page decides, not the filename.** The owner names files as number = paper and letter = attempt, but real files have broken that scheme. Identify each file from its contents only.
5. **Do not edit `*.html` or anything in `*_files`.**
6. **Do not report success until every check in "Verification" passes.** If a check fails, fix the cause or tell the owner exactly what failed.
7. **Stop and ask if the page does not match this document.** Do not guess at a new layout, label or tip format.

## Workflow

1. Classify every `*.html` file (see "Step 1"), not only the new ones.
2. Build all CSVs into a temporary folder, not the project folder.
3. Run all of "Verification" against the temporary copies.
4. Copy the CSVs into the project folder, next to the HTML files.
5. Update "Known state" at the end of this file.
6. Send the owner the report described in "Report to the owner".

Keep any scripts you write outside the project folder. Python with BeautifulSoup (`html.parser`) works; `lxml` was not installed last time. Read files as UTF-8.

## Step 1: Classify each HTML file

Each file starts with a comment holding the page URL:

`<!-- saved from url=(0156)https://.../learn/quiz/4540356/result/1809287521?expanded=1809287521#overview -->`

| Value | Where to get it |
|---|---|
| Quiz ID (identifies the paper) | Number after `/quiz/` in the saved URL |
| Result ID (identifies the attempt) | Number after `/result/` in the saved URL. Summary pages use `/results?expanded=<id>` instead |
| Paper title | Text of `[class*="results-header--title"]`, without the trailing ` - Results` |
| Attempt | First `Attempt \d+` in the text of `[class*="revamped-result-page--revamped-result-page"]` |
| Page counters | Text like `65 all`, `43 correct`, `22 incorrect`, `0 skipped`, `0 marked` in `[class*="revamped-result-page--filter-area"]` |
| Question panes | `[class*="result-pane--question-result-pane-wrapper"]` |

Then treat each file as one of these:

| Type | How to recognise it | What to do |
|---|---|---|
| Full attempt | Panes = the `all` counter | Use it |
| Filtered view | Panes > 0 but fewer than `all` (for example, only 7 of 65 shown) | The counters still show the whole attempt, so never treat it as complete. If a full copy with the same result ID exists, use that and list this file as a source. If not, extract what is visible and report the attempt as incomplete |
| Summary page | 0 panes | It has no questions. Report it, and give the score it shows |
| Duplicate save | Same result ID as another file | Use one copy. The other is still listed in `Source File` |

Group attempts into papers by quiz ID, and into attempts by result ID. Never group by filename.

When several files share a result ID:
- **Read the content from** the file with the most panes. If tied, use the file with the most local image links (`src="./..."`). If still tied, use the first filename in sort order.
- **List them in `Source File`** by most panes first, then filename. Separate them with `, `.

Confirm that duplicates really match before relying on one copy, including their marks. Only image locations should differ, as some saves use `./Xa_files/...` and others use `https://img-c.udemycdn.com/...`.

## Step 2: Choose questions

Within each full attempt, include a question if **either** is true:

- its status label is `Incorrect`
- it is marked unsure with `#icon-saved`

Questions that are `Correct` and marked **are** included. Statuses so far have only been `Correct` and `Incorrect`. If you see anything else, such as `Skipped`, stop and ask the owner.

**Finding `#icon-saved`:** do not search the whole file. Every page defines `<symbol id="icon-saved">`, so a plain search is always one too high. A question is marked only when its pane wrapper has a direct child `<svg>` (class contains `star-rating-icon`) containing `<use xlink:href="#icon-saved">`.

## Step 3: Read each question

Search inside the current pane only. IDs such as `#answer-text` repeat across the page.

| Item | Selector or rule |
|---|---|
| Number | Inside `[class*="pane-title"]`, the `span` with no `data-purpose`, such as `Question 20` |
| Status | `[data-purpose="question-result-header-status-label"]` |
| Question | `#question-prompt`. Do not use `question-header-collapsed-text`, which only holds the "Question N Correct" label |
| Option blocks | `[class*="result-pane--answer-result-pane"]`, in page order |
| Option type | Class on the block's `[data-purpose="answer"]`: `answer-correct`, `answer-incorrect` or `answer-skipped` |
| Option label | `[data-purpose="answer-result-header-user-label"]`, blank if absent |
| Option text | `#answer-text` |
| Option explanation | `#question-explanation`, only present on some papers |
| Overall explanation | `#overall-explanation` |
| Domain | `[class*="domain-pane"] .ud-text-md` |
| Images | `img` inside `#overall-explanation`. Each normally appears twice, once hidden, so keep the first of each `src` |

Class names end in generated suffixes such as `--PLOEU`, so match on the readable part.

**Correct answers and the owner's answers**

| Label | Option type | Correct answer? | Owner chose it? |
|---|---|---|---|
| `Your answer is correct` / `Your selection is correct` | `answer-correct` | Yes | Yes |
| `Correct answer` / `Correct selection` | `answer-correct` | Yes | No |
| `Your answer is incorrect` / `Your selection is incorrect` | `answer-incorrect` | No | Yes |
| none | `answer-skipped` | No | No |

- A correct answer is any option of type `answer-correct`, whether or not the owner chose it.
- The owner's answers are the options whose label starts with `Your`.
- `answer-skipped` only means "not chosen". It does not mean the question was skipped.
- Check every pane in the file: the owner's answers should equal the correct answers exactly when the status is `Correct`.

**Keyword tips**

- The form is the exact text `Keyword tip:`, inside each option's `#question-explanation`.
- The tip runs from `Keyword tip:` to the end of that explanation, **keeping the `Keyword tip:` prefix**.
- Only take tips from correct answers for the `Keyword Tip (Correct Answer)` column. Wrong options' tips stay in their `Option N Explanation` columns.
- "Exam 0N" papers have exactly one tip per option.
- "Practice Test #N" papers have no per-option explanations and no keyword tips. That column stays **blank**. Their "Overall explanation" does not contain tips and must not be mined for one.
- If a page has a different spelling, such as "Key tip" or "Keyword tips:", or a correct answer on an Exam paper has no tip, stop and ask.

## Step 4: Convert HTML to text

Text extraction must match how the page reads, without inventing or merging anything.

**Ordinary text**
- Collapse runs of space, tab, return and newline into one space. Keep non-breaking spaces (`\xa0`).
- Each block element starts a new line: `p`, `div`, `li`, `ol`, `ul`, `h1`–`h6`, `blockquote`, `table`, `tr`.
- `br` becomes a newline.
- Inline elements such as `code`, `strong`, `em` and `span` add **no** extra spaces. Do not use `get_text(" ")` here, because it inserts spaces that aren't in the source.
- Trim spaces, tabs and returns from each line, and drop empty lines. Join lines with one `\n`.

**Code blocks (`pre`)**
- Preserve the text exactly, including indentation.
- Syntax-highlighted blocks are `pre > ol.linenums > li > span`. Each `li` is one line, joined with `\n`. Do not collapse or trim inside `pre`.
- A line holding only `\xa0` is real, so keep it.

**Skip completely**
- `button`, `svg`, `style`, `script`, `img`. This removes UI text such as "Explain this further". Images are recorded in their own column.
- HTML comments.

**Lists:** browsers draw list numbers and bullets, so they are not in the text. Do not add them.

## Step 5: Write the CSVs

**One file per paper.** Name it from the title:

| Title starts with | File name |
|---|---|
| `Practice Test #3 (...` | `Practice_Test_3.csv` |
| `Exam 02 - ...` | `Exam_02.csv` |
| anything else | Ask the owner |

If a paper has several attempts, they share one CSV with **one row per attempt per question**. A question wrong in two attempts therefore gets two rows.

**Rebuild, don't append.** Regenerate each CSV from all of that paper's HTML files.

**Row order:** attempt number, then question number, both numerically.

**File format:** UTF-8 with BOM (Python `encoding="utf-8-sig"`), every field quoted (`csv.QUOTE_ALL`), opened with `newline=""`. This keeps Excel displaying symbols correctly.

**Columns, in this exact order and spelling**

| Column | Content |
|---|---|
| `Test Paper` | Paper title, without ` - Results` |
| `Attempt` | Such as `Attempt 2` |
| `Source File` | Such as `4b.html, 4a.html` |
| `Question Number` | Such as `Question 20` |
| `Result` | Status label as shown: `Incorrect` or `Correct` |
| `Marked Unsure (#icon-saved)` | `Yes` or `No` |
| `Domain` | Domain text |
| `Question` | Question text |
| `Correct Answer(s)` | Correct options in page order, separated by a blank line (`\n\n`) |
| `Keyword Tip (Correct Answer)` | Tips in the same order as `Correct Answer(s)`, separated by `\n\n`. Blank if the paper has none |
| `Your Answer(s)` | The owner's options in page order, separated by `\n\n` |
| `Overall Explanation` | Overall explanation text |
| `Explanation Images` | Each image `src` exactly as written in the HTML, one per line |
| `Option 1` | Option text, in page order |
| `Option 1 Label` | Option label, blank if none |
| `Option 1 Explanation` | Full per-option explanation, blank if none |
| ... | Repeat these three columns through `Option 6` |

Always include all 6 sets of option columns, leaving unused ones blank. If a question has more than 6 options, add more sets to that file and report it.

## Verification

Do all of these before saving to the project folder. The checker must be separate code from the extractor, or it will share the extractor's bugs.

1. **Regression:** for every attempt already listed in "Known state", your new rows must match the existing CSV cell for cell. Only `Source File` may differ, and only if a new duplicate was added. Any other difference means your extractor is wrong. Fix it rather than replacing the good data. If "Known state" lists no attempts, there is nothing to compare yet, so skip this check and tell the owner it was skipped.
2. **Independent parse:** re-read the raw HTML without the extractor's parser, for example with regular expressions and tag-depth counting. Do this for every source file, including duplicates.
3. **Correct row set:** for each full attempt, the CSV's question numbers must equal the `Incorrect` or marked questions on the page, checked in both directions.
4. **Counters:** the pane counts must equal the page's `all`, `correct`, `incorrect` and `marked` counters.
5. **Field match:** compare `Result`, `Domain`, `Question`, `Overall Explanation`, `Correct Answer(s)`, `Your Answer(s)`, `Keyword Tip (Correct Answer)` and all option columns to the source with whitespace removed, and require equality.
6. **Exact line match:** that check cannot see words run together or lost spaces. So also confirm that each line of each cell, with whitespace runs collapsed, appears in the same source field collapsed the same way.
7. **Tip pairing:** each Exam row must have the same number of tips as correct answers. Each tip must come from a correct option.
8. **Mutation test:** in memory, change one word in a tip, delete a character from a question, add text to a correct answer, flip a marked flag, and drop a row. The checker must catch all five. If it misses any, it isn't really checking.
9. **File sanity:** re-read each CSV with a CSV parser. No cell may exceed 32,767 characters (Excel's limit) or contain `�`. If a cell starts with `=`, `+`, `-` or `@`, do not change it, but tell the owner it may display wrongly in Excel.
10. **Read it yourself:** compare at least one multi-answer row, one marked-but-correct row and one code-block row with the HTML, if the batch has them.

## Report to the owner

End with the following, in plain language:

1. **A table:** CSV name, source files, attempt, wrong, marked, rows.
2. **What's missing.** Check for all of these:
    - **Papers:** the course sidebar lists every paper. Items in `[class*="curriculum-item-link--curriculum-item"]` read `Completed Start Practice Test N: <title>`. Report any completed paper with no question data.
    - **Earlier attempts:** a page showing Attempt N proves attempts 1 to N-1 exist. Report any without question data.
    - **Files with problems:** summary pages, filtered views without a full copy, and duplicate saves.
    - **Filename mismatches:** cases where the filename scheme doesn't match the content.
3. **Blank keyword tips:** which papers have none, and why.
4. **Verification results,** including anything that failed or was skipped.

Saying "Attempt 1 only" does not prove no later attempt exists. Report only what the files show.

## Known state

Last updated 2026-11-01. All 12 HTML files were processed in this run, and every attempt below is a full attempt with 65 panes. Earlier HTML files and CSVs were deleted because the saves were wrong, so do not rely on any results from before this run.

Update this table after each run. The `Incorrect` and `Marked` counts come from each attempt's page.

| CSV | Quiz ID | Result ID | Attempt | Source files | Incorrect | Marked | Both | Rows |
|---|---|---|---|---|---|---|---|---|
| Exam_01.csv | 7795407 | 1806597863 | Attempt 1 | 1a.html | 35 | 0 | 0 | 35 |
| Exam_01.csv | 7795407 | 1807477381 | Attempt 3 | 1b.html | 18 | 0 | 0 | 18 |
| Exam_02.csv | 7795617 | 1808143283 | Attempt 1 | 2a.html | 35 | 0 | 0 | 35 |
| Exam_02.csv | 7795617 | 1809330253 | Attempt 2 | 2b.html | 19 | 15 | 8 | 26 |
| Exam_03.csv | 7795621 | 1807677031 | Attempt 1 | 3a.html | 36 | 0 | 0 | 36 |
| Exam_04.csv | 7795623 | 1808566039 | Attempt 1 | 4a.html | 25 | 0 | 0 | 25 |
| Practice_Test_1.csv | 4540356 | 1808628471 | Attempt 1 | 5a.html | 29 | 0 | 0 | 29 |
| Practice_Test_1.csv | 4540356 | 1809287521 | Attempt 2 | 5b.html | 22 | 0 | 0 | 22 |
| Practice_Test_2.csv | 4540360 | 1809034745 | Attempt 1 | 6a.html | 29 | 0 | 0 | 29 |
| Practice_Test_3.csv | 4540362 | 1809209995 | Attempt 1 | 7a.html | 26 | 0 | 0 | 26 |
| Practice_Test_4.csv | 4540364 | 1809233015 | Attempt 1 | 8a.html | 29 | 14 | 8 | 35 |
| Practice_Test_4.csv | 4540364 | 1809273175 | Attempt 2 | 8b.html | 7 | 11 | 5 | 13 |

Total: 329 rows.

**Known gaps:**
- Exam 01 Attempt 2 has no question data. `1b.html` shows Attempt 3, which proves it exists.
- `./6a_files/gp2_iops_1.png` (Practice Test #2 Question 42) is referenced by `6a.html`, but the file is not in `6a_files`.

**Filename mismatches:** `1b.html` is Attempt 3, not Attempt 2.

**Not a test paper:** `Wrong_Questions_Test.html` is the practice page built from the CSVs, not a saved page, so skip it in Step 1. It no longer reads the CSVs: it holds a copy of them, so new or rebuilt CSVs do not reach it until its data is regenerated. Tell the owner when a run leaves it out of date. To regenerate, by program only:
- `<script type="application/json" id="csv-data">` holds `{"files":[{"name":"Exam_01.csv","table":[header,row,...]}],"images":{"./1a_files/x.png":{"id":"...","type":"image/png"}}}`, with every `<` written as `<`.
- Each image is one `<script type="text/plain" id="img-ID">` block of base64, after the main script. `ID` is the first 20 hex characters of the file's SHA-256, so identical files share a block. A path whose file is missing gets no entry, and the page shows "Image file not found".
- Prove the result in a real browser against the CSVs, as in "Verification".

It finds columns by the names in Step 5, so a renamed column must also be changed in the `COL` list in its script.

**Also skip:** `previous_versions/` holds the earlier practice page, which read the CSVs live.

**Extraction notes for matching the regression check:**
- Each pane title has a second span with no `data-purpose`, inside the "Explain this further" button. Take `Question N` from the direct-child span only.
- Plain `pre > code` blocks end in a newline, and it is kept as "do not trim inside `pre`" requires. This leaves a blank line after those blocks in a cell, or a trailing newline if the block ends the cell.
