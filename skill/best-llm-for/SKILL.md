---
name: best-llm-for
description: Pick a language model and know what it costs. Ranks models by area - code, images, video, agents, maths, reasoning - with the source behind every number, compares a lab's own claims against outsiders' measurements, and prices them per million tokens. Use when asked which model to use for a task, what a model costs, how two models compare, which one reads screenshots or video best, what changed recently, or whether a published benchmark figure holds up.
---

# best-llm-for

A CLI over one grid: every model in rows, every benchmark in columns, each
number carrying the page it was published on. Data ships with the package and
works offline; it is rebuilt daily.

## Commands

```bash
npx best-llm-for                    # strongest models for coding, with prices
npx best-llm-for --budget 1         # only models at $1 or less per million input tokens
npx best-llm-for --on gpqa          # every model ranked on one benchmark
npx best-llm-for --scores opus 5    # every published score for one model, and who published it
npx best-llm-for --benchmarks       # every benchmark, grouped by area
npx best-llm-for --area images      # one area: code, images, video, agents, maths, reasoning
npx best-llm-for --new              # models listed in the last two weeks
npx best-llm-for opus 5             # prices, context and vendors for one model
```

`--json` on any of them for structured output. `--limit N` to change how many
rows come back.

## Areas

Six, and a model is only good "at" one of them at a time: **code, images,
video, agents, maths, reasoning**. Match the area to what the user is actually
doing — someone pasting screenshots needs the images area, not a coding score.

There is no overall mark and you should not invent one by averaging. If asked
which model is best full stop, pick the area their task belongs to, give the
benchmark and the number, and say what it does not cover.

## The human line

`--on <benchmark>` prints a `PEOPLE` row where a published human baseline
exists, in the position it earns. Use it when someone asks whether a model is
"better than a person" — the honest answer names the benchmark and the people:
on GPQA-Diamond the models are past PhD holders in their own field (65%); on
MATH a three-time IMO medallist (90%) still leads that column.

Never round it to "humans score X". Say which people. And do not compare a
human baseline across benchmarks — each was measured a different way.

## How to answer with it

**Name the benchmark and who ran it.** "Kimi K3 scores 93.5 on GPQA-Diamond,
self-reported by Moonshot" is an answer someone can check. "Kimi K3 is the best
at reasoning" is not.

**Keep claimed and measured apart.** `self · <lab>` in the WHO RAN IT column
means the lab published the figure about its own model. Anything else is an
outsider who ran the test. When the LAB SAYS column shows a second number, the
gap between the two is worth mentioning — it is usually the most informative
thing on the row.

**Check coverage before ranking.** `--benchmarks` gives the number of models
measured on each. A benchmark with three models is a fact about those three,
not a leaderboard; say so rather than presenting it as one.

**Prices are per million tokens, cheapest standard rate.** Batch and free tiers
are excluded by default because they buy a different product — hours of latency,
or limits that make them unusable in production. `--batch` includes batch rates.

**Say how old the data is.** Every command prints it. A benchmark table from
last month is usually fine; a price from last month may not be.

## What the tool refuses to do

It does not average benchmarks into a single score, does not merge a lab's
figure with an outsider's, and does not carry a lab's numbers about its rivals
at all. If asked for one overall ranking, give the benchmark that best matches
the task and say why that one.

Effort settings (`-high`, `-max`, `-thinking-64k`) are separate rows because
they score differently, and share a price with the base model. When comparing,
compare like with like.
