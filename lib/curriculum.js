// Non-LeetCode tracks: an ordered system design curriculum (fundamentals first,
// then classic case studies and engineering practices) and a bank of
// behavioral / communication interview prompts. Claude writes each lesson and
// grades the answers; these lists only set the order and what to cover.
(function (root) {
  const DESIGN_LESSONS = [
    ["how-the-web-works", "How a request travels the web", "DNS lookup, TCP and TLS handshakes, HTTP request/response, what happens when you type a URL"],
    ["apis", "APIs: REST, RPC and gRPC", "resources and verbs, status codes, REST vs RPC, gRPC and protobuf, when to use each"],
    ["estimation", "Back-of-the-envelope estimation", "latency numbers every engineer should know, QPS, storage and bandwidth math, powers of two"],
    ["scaling", "Vertical vs horizontal scaling", "scale up vs scale out, stateless services, why state is the hard part"],
    ["load-balancing", "Load balancers", "L4 vs L7, round robin, least connections, health checks, sticky sessions"],
    ["caching", "Caching", "cache-aside, write-through, write-back, TTLs, LRU eviction, cache invalidation, thundering herd"],
    ["cdn", "CDNs and edge caching", "how CDNs work, push vs pull, cache keys, static vs dynamic content"],
    ["sql-vs-nosql", "SQL vs NoSQL", "relational model, document, key-value, wide-column and graph stores, choosing one"],
    ["indexes", "Database indexes", "B-trees, how an index speeds reads and slows writes, composite indexes, covering indexes"],
    ["sql-queries", "SQL for interviews", "joins (inner, left, self), GROUP BY and HAVING, subqueries vs CTEs, window functions like ROW_NUMBER and RANK, common query patterns"],
    ["schema-design", "Schema design and normalization", "primary and foreign keys, one-to-many and many-to-many tables, normal forms, when to denormalize, designing tables for a real feature"],
    ["query-performance", "Making queries fast", "reading EXPLAIN plans, full scans vs index seeks, the N+1 query problem, pagination, connection pools, read replicas for heavy reads"],
    ["transactions", "Transactions and isolation levels", "ACID, dirty reads, non-repeatable reads, phantoms, isolation levels, optimistic vs pessimistic locking"],
    ["replication", "Replication", "leader-follower, multi-leader, leaderless, replication lag, read-your-writes"],
    ["sharding", "Sharding and partitioning", "range vs hash partitioning, hot keys, resharding, cross-shard queries"],
    ["consistent-hashing", "Consistent hashing", "the ring, virtual nodes, why it minimizes data movement"],
    ["cap", "CAP and consistency models", "CAP theorem in practice, strong vs eventual consistency, quorum reads and writes"],
    ["queues", "Message queues and pub/sub", "decoupling, at-least-once delivery, Kafka vs RabbitMQ style, consumer groups, backpressure"],
    ["idempotency", "Retries, timeouts and idempotency", "idempotency keys, exponential backoff with jitter, exactly-once illusions"],
    ["rate-limiting", "Rate limiting", "token bucket, leaky bucket, fixed and sliding windows, where to enforce limits"],
    ["unique-ids", "Generating unique IDs", "auto-increment limits, UUIDs, Snowflake IDs, sortability"],
    ["api-design", "Designing a good API", "pagination (offset vs cursor), versioning, error formats, idempotent endpoints"],
    ["blob-storage", "Blob and object storage", "S3-style storage, metadata vs content, presigned URLs, chunked uploads"],
    ["search", "Search and inverted indexes", "tokenizing, inverted indexes, ranking basics, Elasticsearch in an architecture"],
    ["realtime", "Real-time updates", "polling, long polling, WebSockets, server-sent events, push notifications"],
    ["microservices", "Monoliths vs microservices", "service boundaries, service discovery, API gateways, the costs of distribution"],
    ["batch-stream", "Batch vs stream processing", "MapReduce idea, stream processing, windows, lambda vs kappa architecture"],
    ["observability", "Observability", "logs, metrics, traces, dashboards and alerts, the four golden signals"],
    ["reliability", "Reliability and availability", "SLIs, SLOs, SLAs, nines of availability, redundancy, failover, graceful degradation"],
    ["security", "Security basics for engineers", "authentication vs authorization, sessions vs JWTs, OAuth, password hashing, HTTPS, OWASP top risks"],
    ["concurrency", "Concurrency in services", "race conditions, locks, deadlocks, distributed locks, compare-and-set"],
    ["url-shortener", "Case study: URL shortener", "requirements, ID generation, read-heavy caching, redirects, analytics"],
    ["design-rate-limiter", "Case study: distributed rate limiter", "per-user limits across many servers, Redis counters, race conditions, fail-open vs fail-closed"],
    ["news-feed", "Case study: news feed", "fan-out on write vs read, celebrity problem, ranking, feed caching"],
    ["chat", "Case study: chat app", "1:1 and group messages, WebSocket servers, message ordering, delivery receipts, offline users"],
    ["notifications", "Case study: notification system", "push, email and SMS providers, queues, retries, user preferences, deduplication"],
    ["typeahead", "Case study: search autocomplete", "tries, top-k per prefix, precomputation, caching, updating popularity"],
    ["web-crawler", "Case study: web crawler", "URL frontier, politeness, dedup with hashing, robots.txt, distributed workers"],
    ["file-storage", "Case study: Dropbox-style file sync", "chunking, dedup, metadata service, sync conflicts, block storage"],
    ["video", "Case study: video streaming", "upload pipeline, transcoding, adaptive bitrate, CDN delivery"],
    ["ride-sharing", "Case study: ride sharing", "location updates, geohashing or quadtrees, matching drivers, surge"],
    ["leaderboard", "Case study: real-time leaderboard", "sorted sets, top-k, sharded counters, approximate ranking"],
    ["ticketing", "Case study: ticket booking", "seat holds, preventing double booking, transactions vs locks, high-demand drops"],
    ["kv-store", "Case study: distributed key-value store", "partitioning, replication, quorum, vector clocks, gossip, hinted handoff"],
    ["payments", "Case study: payment system", "idempotency, ledgers, double-entry, reconciliation, external provider failures"],
    ["ood", "Object-oriented design interviews", "how to approach low-level design, classes and relationships, SOLID, a parking lot example"],
    ["testing", "Testing like a professional", "unit vs integration vs end-to-end, the testing pyramid, mocks, what makes a test flaky"],
    ["code-review", "Code review and working on a team", "giving and receiving review, small PRs, git branching, writing a good design doc"],
    ["incidents", "Debugging production incidents", "on-call basics, triage, mitigate before root cause, postmortems"]
  ].map(([id, title, points]) => ({ id, title, points }));

  const BEHAVIORAL = [
    ["tell-me-about-yourself", "Tell me about yourself.", "Keep it 60-90 seconds: present, past, why this role."],
    ["why-company", "Why do you want to work here?", "Connect specific things about the company to your goals and skills."],
    ["proud-project", "Tell me about the project you're most proud of.", "What you built, your role, the hardest part, the result."],
    ["technical-challenge", "Describe the hardest technical problem you've solved.", "Show how you broke it down and what you tried."],
    ["disagreement", "Tell me about a time you disagreed with a teammate.", "Show respect, data, and how you reached a decision."],
    ["conflict", "Describe a conflict on a team and how you handled it.", "Focus on your actions and what changed afterwards."],
    ["failure", "Tell me about a time you failed.", "Own it, explain what you learned, show you applied it."],
    ["mistake", "Tell me about a mistake you made that affected others.", "Detection, mitigation, communication, prevention."],
    ["deadline", "Tell me about a time you had a tight deadline.", "Prioritization, trade-offs, communication of risk."],
    ["ambiguity", "Describe a time you worked with unclear requirements.", "How you clarified, made assumptions explicit, iterated."],
    ["learn-fast", "Tell me about a time you had to learn something quickly.", "Your learning strategy and the outcome."],
    ["feedback", "Tell me about a time you received critical feedback.", "Your reaction, what you changed, the result."],
    ["initiative", "Describe a time you took initiative without being asked.", "Ownership, impact, how you brought others along."],
    ["help-teammate", "Tell me about a time you helped a teammate succeed.", "Mentoring, unblocking, sharing credit."],
    ["prioritize", "How do you prioritize when everything is urgent?", "A concrete example with your reasoning."],
    ["customer", "Tell me about a time you went out of your way for a user or customer.", "Understanding needs, measurable impact."],
    ["dive-deep", "Describe a time you dug into data or details to find the real problem.", "Root cause, evidence, outcome."],
    ["changed-mind", "Tell me about a time you changed your mind.", "What new information convinced you."],
    ["difficult-person", "Describe working with someone difficult.", "Empathy, communication, result; no blaming."],
    ["above-beyond", "Tell me about a time you went above and beyond.", "Scope, effort, measurable results."],
    ["leadership", "Tell me about a time you led a group.", "Setting direction, delegating, handling setbacks."],
    ["simplify", "Tell me about a time you simplified something complex.", "Before and after, who benefited."],
    ["explain-hashmap", "Explain how a hash map works to someone non-technical.", "Communication: analogy, no jargon, check understanding."],
    ["explain-project-arch", "Walk me through the architecture of a project you built.", "Components, data flow, trade-offs, what you'd change."],
    ["explain-api", "Explain what an API is to a product manager.", "Communication: clear analogy, why it matters to them."],
    ["think-aloud", "You're stuck in a coding interview. What do you say?", "Communication: narrate, ask clarifying questions, propose a brute force."],
    ["clarify", "An interviewer gives you a vague design prompt. What questions do you ask first?", "Functional vs non-functional requirements, scale, constraints."],
    ["weakness", "What is your biggest weakness?", "A real weakness, what you are doing about it, evidence of progress."],
    ["five-years", "Where do you see yourself in a few years?", "Growth that fits the role and company."],
    ["questions-for-us", "What questions do you have for us?", "Thoughtful questions about the team, work and growth."]
  ].map(([id, question, tip]) => ({ id, question, tip }));

  // LeetCode's "Top SQL 50" study plan, in order (it starts gentle and builds up).
  const SQL_PROBLEMS = [
    ["Select", [["recyclable-and-low-fat-products", "Easy"], ["find-customer-referee", "Easy"], ["big-countries", "Easy"], ["article-views-i", "Easy"], ["invalid-tweets", "Easy"]]],
    ["Basic joins", [["replace-employee-id-with-the-unique-identifier", "Easy"], ["product-sales-analysis-i", "Easy"], ["customer-who-visited-but-did-not-make-any-transactions", "Easy"], ["rising-temperature", "Easy"], ["average-time-of-process-per-machine", "Easy"], ["employee-bonus", "Easy"], ["students-and-examinations", "Easy"], ["managers-with-at-least-5-direct-reports", "Medium"], ["confirmation-rate", "Medium"]]],
    ["Aggregate functions", [["not-boring-movies", "Easy"], ["average-selling-price", "Easy"], ["project-employees-i", "Easy"], ["percentage-of-users-attended-a-contest", "Easy"], ["queries-quality-and-percentage", "Easy"], ["monthly-transactions-i", "Medium"], ["immediate-food-delivery-ii", "Medium"], ["game-play-analysis-iv", "Medium"]]],
    ["Sorting and grouping", [["number-of-unique-subjects-taught-by-each-teacher", "Easy"], ["user-activity-for-the-past-30-days-i", "Easy"], ["product-sales-analysis-iii", "Medium"], ["classes-more-than-5-students", "Easy"], ["find-followers-count", "Easy"], ["biggest-single-number", "Easy"], ["customers-who-bought-all-products", "Medium"]]],
    ["Advanced selects and joins", [["the-number-of-employees-which-report-to-each-employee", "Easy"], ["primary-department-for-each-employee", "Easy"], ["triangle-judgement", "Easy"], ["consecutive-numbers", "Medium"], ["product-price-at-a-given-date", "Medium"], ["last-person-to-fit-in-the-bus", "Medium"], ["count-salary-categories", "Medium"]]],
    ["Subqueries", [["employees-whose-manager-left-the-company", "Easy"], ["exchange-seats", "Medium"], ["movie-rating", "Medium"], ["restaurant-growth", "Medium"], ["friend-requests-ii-who-has-the-most-friends", "Medium"], ["investments-in-2016", "Medium"], ["department-top-three-salaries", "Hard"]]],
    ["Strings, regex and clauses", [["fix-names-in-a-table", "Easy"], ["patients-with-a-condition", "Easy"], ["delete-duplicate-emails", "Easy"], ["second-highest-salary", "Medium"], ["group-sold-products-by-the-date", "Easy"], ["list-the-products-ordered-in-a-period", "Easy"], ["find-users-with-valid-e-mails", "Easy"]]]
  ].flatMap(([group, list]) => list.map(([slug, difficulty]) => ({ slug, difficulty, group })));

  const api = { DESIGN_LESSONS, BEHAVIORAL, SQL_PROBLEMS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof globalThis !== "undefined" ? globalThis : this);
