# Mac curl cross-check

Times are milliseconds; values are median/p75/p95 using nearest-rank. The old API chain uses one curl process per trial with three sequential URLs; zero connect/appconnect on later URLs confirms connection reuse.

## Old API chain

| Endpoint | HTTP | Connect ms | TLS ms | TTFB ms | Total ms | Bytes |
|---|---:|---:|---:|---:|---:|---:|
| auth/me | 401 | 41.0/41.6/42.1 | 87.8/88.4/106.3 | 127.6/128.8/147.4 | 128.0/129.1/147.5 | 75 |
| project/ken-blog | 200 | 0.0/0.0/0.0 | 0.0/0.0/0.0 | 48.1/51.2/362.1 | 86.0/88.6/401.1 | 10044 |
| post/ERD | 200 | 0.0/0.0/0.0 | 0.0/0.0/0.0 | 47.4/48.3/53.0 | 47.7/48.7/55.7 | 20280 |

Sequential chain total (sum of the three request totals): 261.5/265.7/604.3 ms. First trial includes a slower initial project response; all later trials reused the same TLS connection.

## New local ERD HTML

| HTTP | Connect ms | TLS ms | TTFB ms | Total ms | Bytes |
|---:|---:|---:|---:|---:|---:|
| 200 | 41.5/42.3/42.7 | 87.0/88.9/91.3 | 126.5/129.0/131.6 | 205.8/208.5/210.8 | 45191 |

## Public GitHub Pages HTML

| Scenario | HTTP | TTFB ms | Total ms | Bytes |
|---|---:|---:|---:|---:|
| project_home | 200 | 32.7/33.7/245.8 | 34.6/35.1/246.8 | 28328 |
| erd_document | 200 | 36.4/38.1/256.9 | 46.8/47.9/266.6 | 45191 |
| general_post | 200 | 33.5/34.3/224.3 | 33.7/34.6/225.0 | 14257 |
| home_list | 200 | 35.1/40.9/231.4 | 35.2/41.2/231.7 | 1630 |

The public home request returns its small meta-refresh page; curl does not execute the browser redirect to `/ken-blog/posts/`. The first public request for each route is a CDN cold outlier; subsequent requests are warm.
