# which-llm

Every model in rows, every benchmark in columns, each number linked to the page
it was published on — in your terminal.

```bash
npx which-llm
```

The same table as a page: **https://super-squalo.github.io/which-llm/**

Each lab publishes the slice of the picture that flatters it, on its own page,
under its own spelling of the benchmark's name. Nobody publishes the table.
This builds it.

## What it answers

```bash
npx which-llm                    # strongest models for coding, and what they cost
npx which-llm --budget 1         # only what costs $1 or less per million input tokens
npx which-llm --on gpqa          # every model ranked on one benchmark
npx which-llm --scores opus 5    # every published score for one model, with who published it
npx which-llm --benchmarks       # every benchmark, grouped by area
npx which-llm --area images      # one area at a time: code, images, video, agents, maths, reasoning
npx which-llm --new              # models that turned up in the last two weeks
npx which-llm opus 5             # prices, context, vendors for one model
```

Add `--json` to any of them.

## Six areas, no overall mark

Nobody wakes up wanting a model's MMStar score. They want to know whether it can
write code, read a screenshot, follow a video, do the maths, hold an argument
together, or drive a tool without falling over. So every benchmark belongs to
exactly one area and the table is read one area at a time.

| Area | What it covers | Models with a score |
| --- | --- | --- |
| Code | writing it, editing a real repo until the tests pass | 144 |
| Images | screenshots, charts, scanned pages, diagrams | 273 |
| Video | following something that moves, over minutes | 52 |
| Agents | tools, browsing, driving a computer to finish a job | 9 |
| Maths | competition problems, arithmetic that has to be exact | 69 |
| Reasoning & knowledge | hard questions, long documents, staying factual | 176 |

**No area is averaged into a single mark.** The benchmarks inside one measure
different things on different scales; their mean would be a number nobody
published and nobody could check. The area picks the columns — the scores stay
the scores.

Two things are never the column an area opens on: a run where the model was
given help (`with subtitles`, `w/ tools` — the assisted number is always the
higher one), and the one benchmark where lower is better (hallucination rate,
which sorted like the others puts the worst model on top).

## And people?

The comparison the field started with and mostly stopped printing. Where
someone has published what people score on the same test, it sits in the table
as a pinned row and in the CLI as a `PEOPLE` line, in the position it earns.

| Benchmark | People | Who, exactly |
| --- | --- | --- |
| MMLU | 89.8 | estimated expert level, from 95th-percentile scores on the real exams |
| MATH | 90.0 / 40.0 | a three-time IMO gold medallist / a CS PhD student who dislikes maths |
| MMMU | 88.6 | human experts, best of three panels |
| GPQA-Diamond | 65.0 / 34.0 | PhD holders in the question's own field / skilled non-experts with the web |
| MathVista | 60.3 | human performance on the testmini split |
| ARC-AGI-2 | 100 | task coverage by a panel of 400+ volunteers, not one person's accuracy |

Two rules keep this honest. **It never says "humans".** It says which people,
doing what, because one medallist on twenty problems and four hundred
volunteers on a puzzle set are different facts. And **it is never sorted as a
competitor** — every baseline was measured its own way, so it is a line of
context beside the ranking, not another row inside it.

Most benchmarks have no human baseline at all — nobody ever ran people through
SWE-bench or Aider's polyglot exercises — and that silence is left visible
rather than filled with a plausible number.

## The four rules

**A lab's figures for its rivals are thrown away.** Only a score published by
the lab that built the model is kept. Launch tables set a new model against
whatever the competition shipped a year earlier — OpenAI's 2025 tables run
against Claude 3.5 Sonnet, Gemini 1.0 Ultra and Llama 3.1 — and nobody picks a
rival's best run to stand next to. Currently 28 such claims are discarded on
every build, and the build says so.

**Claimed and measured never merge.** A lab marking its own homework and an
outsider running the same test are different kinds of evidence. Both are kept,
labelled, and shown next to each other. The gap between them is often the most
useful number on the row.

**A rename has to bring evidence.** OpenAI's `GPQA` column is filed under
`GPQA-Diamond` because `gpqa_eval.py` takes `variant: str = "diamond"` and loads
`gpqa_diamond.csv` — the code says what was run. Where the evidence runs out the
score gets its own column rather than a guess: OpenAI's `MATH` is MATH-500 for
the o-series and the full MATH set for everything released before o1, so the
three models in between are filed as `MATH-unspecified` until OpenAI says which
they ran. Every rename carries the sentence that justifies it, and the build
prints the full list.

**Settings are not models.** `-high`, `-max` and `-thinking-64k` are the same
weights thinking for longer. They earn different scores so they keep separate
rows, and they share a price, a release date and a family.

## Where the numbers come from

| Source | Kind | What it gives |
| --- | --- | --- |
| [OpenRouter](https://openrouter.ai/api/v1/models) | prices | ~400 models, every reseller, plus the day each was listed |
| [LiteLLM](https://github.com/BerriAI/litellm) | prices | ~2,800 models, first-party list prices |
| [LiveBench](https://livebench.ai/) | independent | questions written after the models shipped, so nothing was trained on them |
| [OpenVLM](https://huggingface.co/spaces/opencompass/open_vlm_leaderboard) | independent | vision benchmarks on 284 models, run by OpenCompass |
| [Video-MME](https://video-mme.github.io/home_page.html) | independent | 900 videos, seconds to an hour, with and without subtitles |
| [Aider polyglot](https://aider.chat/docs/leaderboards/) | independent | 225 exercises in six languages, edited in a real repo until the tests pass |
| [EvalPlus](https://evalplus.github.io/leaderboard.html) | independent | HumanEval and MBPP rerun with ~80x more tests |
| [Vectara](https://github.com/vectara/hallucination-leaderboard) | independent | hallucination rate on a fixed document set |
| DeepSeek, Moonshot, Qwen, Z.ai model cards | self-reported | the benchmark tables shipped with the weights |
| OpenAI [simple-evals](https://github.com/openai/simple-evals), Google, xAI announcements | self-reported | what each lab published about its own models |
| Anthropic [docs](https://platform.claude.com/docs/en/about-claude/models/overview) | specs | context, pricing, knowledge cutoff |

Who these sources are and what their terms allow is set out in
[DATA-SOURCES.md](DATA-SOURCES.md). What is redistributed here is published
figures, each attributed and linked — no datasets, no harnesses, no weights.

Prices are replaced on every run — a stale price sends someone to pay more than
they needed to. Benchmark scores accumulate and are never deleted: a source
going dark costs future models, never the archive.

### What is missing, and why

Agents is the thinnest area by far: nine models. The benchmarks labs quote for
it — Toolathlon, Agents' Last Exam, AutomationBench — are new, and no outsider
publishes machine-readable results for them yet. That gap is visible in the
table rather than papered over with a related number.

Anthropic, Google and xAI publish their benchmark results as **charts**, not
tables, so only what they wrote in prose can be collected. Meta's and Mistral's
current model cards have no machine-readable results table either. Those gaps
are real and visible in the data rather than filled in by eye.

LiveBench scores are kept per task rather than rolled into the headline average
the site shows: the task-to-category mapping behind that average is not
published in machine-readable form, and computing something that looks like
their number without using their method would be a fake.

## Freshness

The data is rebuilt daily by a GitHub Action and ships inside the package, so
every command works offline. `--refresh` ignores the local cache; the footer
always says how old the figures are and where they came from.

## Contributing a source

A source qualifies if it publishes results in a machine-readable form at a
stable URL and either ran the tests itself or is the lab that built the model.
Add a reader to `scripts/independent.ts` (outsiders) or a card to
`scripts/cards.ts` (labs), and a rule to `scripts/benchmarks.ts` if it spells a
benchmark differently — with the quote or the line of code that proves the two
names mean the same test.

## As a Claude Code skill

The package ships one in `skill/which-llm/`. Copy it into a project's
`.claude/skills/` (or `~/.claude/skills/` for every project) and Claude answers
model-choice questions from this data instead of from memory — with the
benchmark named, the source cited, and the lab's own claims kept apart from
outsiders' measurements.

```bash
cp -r node_modules/which-llm/skill/which-llm .claude/skills/
```

## Development

```bash
npm install
npm run collect      # prices and listing dates
npm run cards        # model cards from the labs
npm run independent  # third-party leaderboards
npm run grid         # build the grid, print every rename it made
npm run site         # rebuild the page
npm run update       # all of the above, in order
npm test
```

MIT — see [LICENSE](LICENSE). The data keeps the terms of the sources it came
from; see [DATA-SOURCES.md](DATA-SOURCES.md).
