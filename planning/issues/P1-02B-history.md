# P1-02B 이력 대응표

실제 재작성: 2026-09-25 UTC. 기존 author 이름·이메일·날짜·커밋 메시지 유지. 아래 31개는 기존 커밋의 대체 이력이며, 이번 계획·검증 기록은 별도 실제 날짜의 문서 커밋으로 추가.

이전 Actions 실행과 문서의 원본 SHA는 정정 전 코드의 당시 증거. 재작성된 코드의 검증은 [P1-02B](P1-02B.md)의 실제 실행 결과 참고.

| 기존 SHA | 새 SHA | 유지한 author date | 커밋 |
| --- | --- | --- | --- |
| `84f084682afd321bb02d301803ef4cd6f6a94a34` | `d0f585f1d8af1ca3ba18ff4c6c014073533980f3` | 2026-05-01T19:20:00+09:00 | chore: initialize monorepo structure and development plan |
| `2f68f3f085694ce16063a2e8bf8b096b9c1102c5` | `854f591842373ff9babdda8b32f08474fbae2726` | 2026-05-01T21:10:00+09:00 | build(api): initialize Kotlin Spring Boot application |
| `dd917c6c4e24e43e61870c280f0d1da9b9c3b23e` | `2234c4942238f39e28cf45848195e67f7167d172` | 2026-05-03T20:25:00+09:00 | build(web): initialize Next.js application |
| `a93e76c9279ea30e92026f15d6501a8edbb45d32` | `80699e2e53233371c2f3863a04b548d50d49260a` | 2026-05-04T20:05:00+09:00 | ci: verify web and api builds |
| `fbad83e582c4fc21ae9a528cb1f38e721ad0586f` | `eb7e26d12d2242f63fc5493cae8c061282fed36f` | 2026-05-05T19:35:00+09:00 | docs: record fresh project bootstrap verification |
| `73fd2766d178bf337db5daac6d8ddb9cf890b99a` | `4d6afbedf7c39c9cdd1a3f4fc06884102236ee17` | 2026-05-06T20:15:00+09:00 | docs: define API contracts and error handling scope |
| `1aec78dbbfad1b808a85e3acf06331dc1feb01d7` | `74158b2e823cee4278b60749f7835db08d1a05cc` | 2026-05-07T21:10:00+09:00 | feat(api): add status endpoint and OpenAPI contract |
| `2983a092d0850666a88d5f751bb7e3843dbbee73` | `b8673ae5fd5f65cd7c93cdf971177a795fed0bc8` | 2026-05-09T15:25:00+09:00 | feat(api): standardize problem responses and verify HTTP contracts |
| `9bb4bc1a94633f82143bc9a721073e58ffc9ad1c` | `2eba4435ce21d494827308bd4778cc452be36585` | 2026-05-10T18:40:00+09:00 | docs: record API verification and plan web integration |
| `526b04b1da3b11314d88cbb209f53d5e97b810a1` | `a6552a17cd9a8cb109e45586389e4a9054bf69c6` | 2026-05-11T20:35:00+09:00 | docs: define server-side API connection scope |
| `d0d9b40ddf70b825e1146012e6febb2f8193b738` | `4001474e4880134f62f8e162e6598edef9a26330` | 2026-05-12T21:20:00+09:00 | feat(web): show server-side API connection status |
| `4e52a6c0057d8684a2d898a4354d53bf6378da0b` | `c9719046e02bedfadadf29f478d4396b55f1924e` | 2026-05-14T20:05:00+09:00 | ci: verify API status handling and disconnected startup |
| `f0c54b63bb5ace623d6332bd6c41c8df951c40ed` | `71cd8c369e5c1a8741517ab9dbe086307bc49f74` | 2026-05-15T19:10:00+09:00 | docs: record web integration verification and runtime plan |
| `d59743101eb4658a0abfae7caf7477dd5210407d` | `0e09d2f947913660f02e0287ad0c1fdbb9b5909f` | 2026-05-17T14:20:00+09:00 | docs: define container runtime and architecture publication scope |
| `1a22ee063a98073c896ec46ce6d4b42d78968421` | `08c7fa0bd531cf21364c560827a6b364121ac36f` | 2026-05-17T18:45:00+09:00 | docs: align deployment plan with static frontend hosting |
| `f2772fdcf2e46d17718653cda12ba5fbef4d2890` | `3cb9899446e260081bd555905055fc9fe02cfa56` | 2026-05-18T21:15:00+09:00 | feat(api): package standalone runtime and allow static frontend requests |
| `eb81df6216cb212316a8bc4a30b12c4adb1e31d8` | `698efa7f3238b803429c7262cf2da8ad3cb235ee` | 2026-05-20T20:10:00+09:00 | feat(web): export static frontend with browser API status |
| `c9b9d83e9c629e6b418951198bb9326459a2d575` | `0763af60262910ee3e0425638d87101eaafe6a58` | 2026-05-21T19:35:00+09:00 | ci: publish static site and architecture on GitHub Pages |
| `8026134c191a4936cc350cc46f7760a3a0b9b7dc` | `6e840ce8af0d01080eddb9c8f043eccef0e40535` | 2026-05-22T20:40:00+09:00 | docs: record static deployment verification and persistence plan |
| `029a8e10146a97bd83fe54f6a1309d5f50e177ae` | `e755fe17e5c8fa2896c8775fc9f63fc2b90508cb` | 2026-05-24T15:10:00+09:00 | docs: approve MySQL persistence implementation scope |
| `b05e75c71bb1849703096dd4539628eefab294d1` | `dae619fb332e5f73ae1b17b9d664268c6805ced8` | 2026-05-25T21:20:00+09:00 | feat(api): persist post drafts with MySQL and Flyway |
| `14d0f50d7735dff3e33f9a991bdab2d37a516eb3` | `066427703b98365a98ec7f4f5ea13c7b1f27dcf8` | 2026-05-27T19:15:00+09:00 | docs: show local MySQL persistence in architecture |
| `9b02cc43c6f4ac395a73e1295d99e571c149fcb2` | `bcc3018411901e747e223372b8405e389a06a883` | 2026-05-28T20:25:00+09:00 | docs: record persistence verification and authentication plan |
| `d0c51998bfe59b183f4acc79d901a55a2cd36c7d` | `d8027e8e5bd133004eec2d4ae895a13a597560e7` | 2026-05-29T19:10:00+09:00 | docs: define authentication scope and change-based commits |
| `68d8bcaa65b7cb84b7ded5f4758f1b12b34e82f3` | `303aa47d50c0fa09f3f19024cc4c0b27d68e3185` | 2026-05-29T21:35:00+09:00 | feat(api): add persistent admin account foundation |
| `3fd6bf52e5953527ee31657e40d9036d99beddb3` | `7e27e7b2162895bb35b76f067a3c0df548a02807` | 2026-05-30T20:10:00+09:00 | feat(api): secure authentication with Redis sessions |
| `91837100587ce20a28400960f679b85fc0247261` | `3b3a950a882ae5da2d943bb4a1465d9ded2f53b4` | 2026-05-30T21:45:00+09:00 | docs: show Redis session storage in architecture |
| `46a10109e07665f9df5cb5fd4cc0c9a6ed2c50f6` | `37d58ab585b3a64a1a8fc77060d9730ebba5c527` | 2026-05-31T17:20:00+09:00 | refactor(api): organize packages by feature and responsibility |
| `7347ce05c39644a2d71f8c01490dc40a3bb69d36` | `0fc8def9bceb0754d47c663440cc745b9b542b55` | 2026-06-01T19:20:00+09:00 | refactor(auth): persist sessions in MySQL with JDBC |
| `b75acb2fa44c44c4c7f4a07121e09c679ffded5f` | `6ca87f5652f817bb5013aa8ea69c203614d87c42` | 2026-06-01T21:05:00+09:00 | docs: show MySQL session storage in architecture |
| `daf74882d2a71e9a568b9cc4fa21a74e8992ae2d` | `dc2d47216e8fa641db0b068a99c0b76b9baf2db2` | 2026-06-02T19:10:00+09:00 | docs: record JDBC session verification and operating boundaries |
