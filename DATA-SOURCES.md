# Where the data comes from, and under what terms

This package ships a `data/` directory built from other people's published
results. Every figure in it links back to the page it was read from, and the
grid records who produced it and when. This file says who those people are and
what their terms allow, in one place, so nobody has to reverse-engineer it from
the code.

**What is redistributed:** published benchmark scores, prices and dates —
individual facts, each attributed and linked to its source. No datasets, no
evaluation harnesses, no scraped question sets, no model weights.

**What is not:** the benchmarks themselves. If you want to *run* any of these
tests, go to the source below and use their harness under their licence.

## Independent evaluators

| Source | What is taken | Licence / terms |
| --- | --- | --- |
| [LiveBench](https://livebench.ai/) | task-level scores from the published leaderboard CSV | leaderboard published openly; code Apache-2.0 ([repo](https://github.com/LiveBench/LiveBench)) |
| [Aider polyglot](https://aider.chat/docs/leaderboards/) | pass rates from `polyglot_leaderboard.yml` | Aider is Apache-2.0 ([repo](https://github.com/Aider-AI/aider)) |
| [EvalPlus](https://evalplus.github.io/leaderboard.html) | HumanEval/MBPP pass@1 from `results.json` | leaderboard site published openly; project Apache-2.0 ([repo](https://github.com/evalplus/evalplus)) |
| [Vectara hallucination leaderboard](https://github.com/vectara/hallucination-leaderboard) | hallucination and factual-consistency rates from the README table | published openly in a public repository |
| [OpenVLM / OpenCompass](https://huggingface.co/spaces/opencompass/open_vlm_leaderboard) | headline score per vision benchmark from `OpenVLM.json` | VLMEvalKit is Apache-2.0 ([repo](https://github.com/open-compass/VLMEvalKit)) |
| [Video-MME](https://video-mme.github.io/home_page.html) | overall scores with and without subtitles from the leaderboard table | published openly on the project page |

## Price and availability feeds

| Source | What is taken | Terms |
| --- | --- | --- |
| [OpenRouter](https://openrouter.ai/api/v1/models) | per-token prices, context length, listing date | public API, no key required for the models endpoint |
| [LiteLLM](https://github.com/BerriAI/litellm) | first-party list prices from `model_prices_and_context_window.json` | MIT |

## Labs reporting on their own models

Read from the model card or announcement each lab publishes, and kept only
where the lab that published the figure also built the model.

| Source | Terms |
| --- | --- |
| [DeepSeek-V4-Pro](https://huggingface.co/deepseek-ai/DeepSeek-V4-Pro-0813) model card | published openly on Hugging Face |
| [GLM-5.3](https://huggingface.co/zai-org/GLM-5.3) model card | published openly on Hugging Face |
| [Qwen3.8](https://huggingface.co/Qwen/Qwen3.8-2.4T-A95B) model card | published openly on Hugging Face |
| [Kimi K3](https://huggingface.co/moonshotai/Kimi-K3) model card | published openly on Hugging Face |
| [openai/simple-evals](https://github.com/openai/simple-evals) | MIT |
| [Google](https://blog.google/technology/google-deepmind/) and [xAI](https://x.ai/news/) announcements | quoted figures, linked to the announcement |
| [Anthropic model docs](https://platform.claude.com/docs/en/about-claude/models/overview) | specifications only: context, pricing, cutoff |

## Human baselines

Collected by hand in `data/human/baselines.json`, one entry per published
figure, each carrying the sentence that states it and a link to the paper or
leaderboard it appears in.

| Benchmark | Source |
| --- | --- |
| GPQA-Diamond | [arXiv:2311.12022](https://arxiv.org/abs/2311.12022) |
| MMLU | [arXiv:2009.03300](https://arxiv.org/abs/2009.03300) |
| MATH | [arXiv:2103.03874](https://arxiv.org/abs/2103.03874) |
| MathVista | [arXiv:2310.02255](https://arxiv.org/abs/2310.02255) |
| MMMU | [MMMU leaderboard](https://mmmu-benchmark.github.io/) |
| ARC-AGI-2 | [ARC Prize](https://arcprize.org/arc-agi/2/) |

## If you are one of these sources

The code that reads your page is one file, named after you, in `scripts/`. If
you would rather not be included, or the reader is getting something wrong,
open an issue and it comes out or gets fixed — no argument.

## Collector behaviour

Every fetch identifies itself as
`best-llm-for collector (+https://github.com/super-squalo/best-llm-for)`. The full
run makes about a dozen requests, once a day, and each source is read at most
once per run.
