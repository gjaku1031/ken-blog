# Excluded exploratory Mermaid runs

These three partial files are retained for audit but excluded from all reported statistics:

- `erd-new-replacement.jsonl`: early browser instrumentation pass; its observer did not consistently follow Mermaid's lazy-render replacement.
- `erd-new-readiness.jsonl`: early readiness pass checked the wrong rendered output representation and did not reliably observe the site's Blob-backed image.
- `erd-new-final.jsonl`: partial follow-up using the preceding instrumentation, before the dedicated six-block scroll-and-image-readiness script was finalized.

Use only `../diagram-readiness.jsonl` for the reported Mermaid result. `scripts/run-diagram-readiness.cjs` scrolls each block into view and records readiness when the resulting image is complete and has nonzero `naturalWidth`; all six rendered in all 80 measured visits.
