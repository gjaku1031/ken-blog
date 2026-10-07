# Mermaid diagram readiness

The static site exposes six Mermaid blocks lazily through an IntersectionObserver. Each block was scrolled into view; readiness was recorded when its sanitized SVG-backed image completed.

Measured readiness navigations: 80; discarded warmups: 8; all six rendered: 80/80. Percentiles use nearest-rank.

| Profile | Cache | n | Ready ms median | p75 | p95 | rendered count |
|---|---|---:|---:|---:|---:|---:|
| R | cold | 20 | 2977.3 | 2990.9 | 3040.8 | 20/20 |
| R | warm | 20 | 2506.9 | 2569.5 | 2617.2 | 20/20 |
| M | cold | 20 | 8992.1 | 9083.0 | 9293.0 | 20/20 |
| M | warm | 20 | 8482.6 | 8604.1 | 8743.5 | 20/20 |

## Rendering comparison

- Old renderer: Mermaid blocks [6], rendered outputs [0], source fallback notices [6]; no readiness time because none of the six diagrams rendered.
- New renderer in the normal, unscrolled browser run: one viewport-visible diagram rendered at a time. In the separate readiness run, scrolling all six blocks resulted in six successful image outputs in every measured visit.
