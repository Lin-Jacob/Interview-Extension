// Fixed quiz questions for each system design lesson, so every student gets the
// same three questions whichever AI tool writes the lesson and grades it. Each
// lesson has one question that checks understanding, one that applies the idea
// to a scenario, and one about a trade-off. Keys match DESIGN_LESSONS ids.
(function (root) {
  const LESSON_QUIZZES = {
    "how-the-web-works": [
      "What happens, step by step, between typing a URL into the browser and the page starting to load?",
      "A user says your site is slow only the very first time they visit it each day. Which steps of a request could explain that, and why?",
      "HTTPS adds a TLS handshake to every new connection. What does it cost, what does it buy you, and how do browsers reduce the cost?"
    ],
    "apis": [
      "What is the difference between a REST API and an RPC-style API?",
      "You need an API between two internal services that exchange many small messages per second. Would you pick REST with JSON or gRPC, and why?",
      "What do you give up when you choose gRPC instead of REST for a public API used by web browsers and outside developers?"
    ],
    "estimation": [
      "Roughly how much slower is reading from disk or over the network than reading from memory, and why does that matter in a design?",
      "Estimate the storage needed per year for a service where 10 million users each upload 2 photos a day at about 500 KB each. Show your steps.",
      "When is a rough back-of-the-envelope estimate good enough in an interview, and when should you slow down to be more precise?"
    ],
    "scaling": [
      "What is the difference between vertical and horizontal scaling?",
      "Your web server stores logged-in users' sessions in its own memory, and you want to add a second server. What breaks, and how would you fix it?",
      "Why might a team scale vertically first even though horizontal scaling can go further?"
    ],
    "load-balancing": [
      "What is the difference between a layer 4 and a layer 7 load balancer?",
      "One of your five servers starts timing out on every request. How should the load balancer notice and handle it?",
      "What are the pros and cons of sticky sessions?"
    ],
    "caching": [
      "Explain the cache-aside pattern: what happens on a cache hit and on a cache miss?",
      "A popular product page's cache entry expires and thousands of requests hit the database at once. What is this problem called and how would you prevent it?",
      "Compare write-through and write-back caching. When would you choose each?"
    ],
    "cdn": [
      "What is a CDN and how does it make a website faster?",
      "You deploy a new version of your site's JavaScript file, but some users still get the old one from the CDN. Why, and how would you avoid it?",
      "What is the trade-off between push and pull CDNs?"
    ],
    "sql-vs-nosql": [
      "What are the main differences between a relational database and a document database?",
      "You're building a social app where users have profiles, posts, comments and followers. Which kind of database would you start with, and why?",
      "What do you give up when you choose a NoSQL key-value store over a relational database?"
    ],
    "indexes": [
      "How does a B-tree index make a lookup faster than scanning the whole table?",
      "A query filters by `user_id` and sorts by `created_at`, and it's slow. What index would you add, and why does the column order matter?",
      "Why not add an index on every column?"
    ],
    "sql-queries": [
      "What is the difference between an INNER JOIN and a LEFT JOIN?",
      "Given an `orders` table (`customer_id`, `amount`, `created_at`), describe how you would find each customer's most recent order.",
      "When would you use a CTE instead of a subquery, and is there any downside?"
    ],
    "schema-design": [
      "What problem does normalization solve, and what is a foreign key for?",
      "Design the tables for students enrolling in courses, where a student takes many courses and a course has many students.",
      "When would you deliberately denormalize a schema, and what does it cost you?"
    ],
    "query-performance": [
      "What does an EXPLAIN plan tell you, and what is the difference between a full table scan and an index seek?",
      "A page shows 50 blog posts with their authors, and the logs show 51 database queries per page load. What is happening and how would you fix it?",
      "What are the trade-offs between offset pagination and cursor (keyset) pagination?"
    ],
    "transactions": [
      "What do the four letters in ACID mean?",
      "Two users try to book the last seat on a flight at the same moment. How can a transaction or locking prevent both from getting it?",
      "Compare optimistic and pessimistic locking. When does each work better?"
    ],
    "replication": [
      "How does leader-follower replication work?",
      "A user updates their profile and then refreshes the page, but sees the old version. What could cause this, and how would you fix it?",
      "What are the trade-offs between synchronous and asynchronous replication?"
    ],
    "sharding": [
      "What is sharding, and why would a database need it?",
      "You shard a users table by country, and one country's shard is overloaded. What went wrong and what would you do?",
      "Compare range-based and hash-based partitioning."
    ],
    "consistent-hashing": [
      "How does consistent hashing assign keys to servers?",
      "You have 10 cache servers using `hash(key) % 10` and you add an 11th. What happens to the cache, and how would consistent hashing help?",
      "Why use virtual nodes, and what do they cost?"
    ],
    "cap": [
      "What does the CAP theorem say, in practical terms?",
      "For a shopping cart and for a bank account balance, would you favor availability or consistency during a network partition? Explain each.",
      "What is the trade-off when you tune quorum reads and writes (R and W) in a replicated store?"
    ],
    "queues": [
      "Why put a message queue between two services instead of having one call the other directly?",
      "An order service publishes \"order placed\" events, and the email service sometimes gets the same event twice. Why can this happen, and how should the email service handle it?",
      "What are the trade-offs between a log-based system like Kafka and a traditional queue like RabbitMQ?"
    ],
    "idempotency": [
      "What does it mean for an API operation to be idempotent?",
      "A mobile app's \"Pay\" request times out and the app retries it. How do you make sure the customer is only charged once?",
      "Why add jitter to exponential backoff, and what happens if you retry without any backoff?"
    ],
    "rate-limiting": [
      "How does the token bucket algorithm work?",
      "Your public API is getting hammered by one customer's buggy script. Where would you enforce a rate limit, and what should that customer see?",
      "Compare fixed-window and sliding-window rate limiting."
    ],
    "unique-ids": [
      "Why do auto-increment IDs become a problem in a distributed system?",
      "You need IDs for tweets that are unique across many servers and roughly sortable by time. How would you generate them?",
      "What are the trade-offs of random UUIDs as primary keys?"
    ],
    "api-design": [
      "What makes an API endpoint idempotent, and which HTTP methods are expected to be?",
      "A mobile client lists a user's messages and new messages keep arriving while they scroll. Which pagination approach would you use, and why?",
      "What are the trade-offs between putting the API version in the URL and putting it in a header?"
    ],
    "blob-storage": [
      "Why store large files like images in object storage instead of in the database?",
      "Users upload 2 GB videos from their phones and uploads often fail halfway. How would you design the upload flow?",
      "What are the pros and cons of letting clients upload directly to storage with presigned URLs instead of sending files through your servers?"
    ],
    "search": [
      "What is an inverted index, and why does it make text search fast?",
      "Users search a product catalog stored in Postgres and LIKE queries are slow. How would you add a search engine like Elasticsearch, and how would you keep it in sync?",
      "What do you give up by serving search from a separate search index instead of the main database?"
    ],
    "realtime": [
      "What is the difference between polling, long polling and WebSockets?",
      "You're building a live sports score page viewed by a million people at once. Which technique would you use to push updates, and why?",
      "What makes WebSockets harder to run at scale than ordinary HTTP requests?"
    ],
    "microservices": [
      "What is the difference between a monolith and microservices?",
      "A five-person startup asks whether to build its new product as microservices from day one. What would you advise, and why?",
      "What new problems do microservices introduce that a monolith doesn't have?"
    ],
    "batch-stream": [
      "What is the difference between batch processing and stream processing?",
      "You need a daily report of total sales and also an alert within seconds when fraud is detected. How would you build each?",
      "What are the trade-offs between the lambda and kappa architectures?"
    ],
    "observability": [
      "What is the difference between logs, metrics and traces?",
      "Users report that checkout is slow, but only sometimes. How would you use logs, metrics and traces to find the cause?",
      "Why is alerting on every error a bad idea, and what should alerts be based on instead?"
    ],
    "reliability": [
      "What is the difference between an SLI, an SLO and an SLA?",
      "Your service depends on a recommendations service that goes down. How can your service degrade gracefully instead of failing?",
      "Going from 99.9% to 99.99% availability: what does it mean in downtime per year, and what does it cost to achieve?"
    ],
    "security": [
      "What is the difference between authentication and authorization?",
      "A teammate stores user passwords encrypted with a single key in the database. What is wrong with this, and what should they do instead?",
      "Compare server-side sessions and JWTs for keeping users logged in."
    ],
    "concurrency": [
      "What is a race condition? Give a simple example.",
      "Two instances of a job both process the same daily batch because they start at the same time. How could you make sure only one runs?",
      "What are the trade-offs between using locks and using compare-and-set (optimistic) updates?"
    ],
    "url-shortener": [
      "What are the core requirements and main API endpoints of a URL shortener?",
      "Your short links get 100 times more reads than writes, and a few links go viral. How would you design the read path?",
      "Should a redirect use a 301 or a 302 status code? What does each choice cost you?"
    ],
    "design-rate-limiter": [
      "How can a rate limiter enforce a per-user limit when requests for that user hit many different servers?",
      "Two requests from the same user arrive at the same instant on different servers and both read a count of 99 against a limit of 100. What goes wrong, and how do you fix it?",
      "If the Redis cluster behind your rate limiter goes down, should the limiter fail open or fail closed? Explain the trade-off."
    ],
    "news-feed": [
      "What is the difference between fan-out on write and fan-out on read for a news feed?",
      "A celebrity with 50 million followers posts. How should your feed system handle it?",
      "What are the trade-offs of precomputing feeds versus building them when the user opens the app?"
    ],
    "chat": [
      "Why do chat apps usually use WebSockets, and what does a chat server keep track of?",
      "A user sends a message while the recipient is offline. Walk through how the message is stored and delivered when they come back online.",
      "What makes message ordering hard in group chats, and what trade-offs do the common solutions make?"
    ],
    "notifications": [
      "What are the main components of a notification system that sends push, email and SMS?",
      "An email provider is down for an hour. How should your system behave so users still get their notifications without duplicates?",
      "What are the trade-offs of sending notifications synchronously from the service that triggers them versus through a queue?"
    ],
    "typeahead": [
      "How can a trie be used to return the top suggestions for a prefix?",
      "Search autocomplete has to respond within about 100 ms for millions of users. How would you serve it fast?",
      "What is the trade-off between updating suggestion popularity in real time and rebuilding it in batches?"
    ],
    "web-crawler": [
      "What is the URL frontier in a web crawler, and what does it do?",
      "Your crawler accidentally sends hundreds of requests per second to one small website. How would you design politeness into the crawler?",
      "How would you detect duplicate pages, and what is the trade-off between exact and near-duplicate detection?"
    ],
    "file-storage": [
      "Why does a file sync service split files into chunks?",
      "A user edits the same file on two laptops while offline, then both come online. How should the system handle the conflict?",
      "What are the trade-offs of deduplicating chunks across all users?"
    ],
    "video": [
      "Why are uploaded videos transcoded into several resolutions and formats?",
      "A viewer's connection drops from fast Wi-Fi to a weak cellular signal mid-video. How does adaptive bitrate streaming keep the video playing?",
      "What is the trade-off between transcoding every video into every format up front and transcoding on demand?"
    ],
    "ride-sharing": [
      "How can geohashing or a quadtree help find nearby drivers quickly?",
      "Hundreds of thousands of drivers send their location every few seconds. How would you handle that write load?",
      "When matching a rider to a driver, what is the trade-off between picking the closest driver right away and waiting briefly to find a better match?"
    ],
    "leaderboard": [
      "How does a sorted set (like Redis ZSET) support a leaderboard?",
      "A game with 100 million players wants to show each player their exact global rank. What makes this hard, and how would you approach it?",
      "When is an approximate rank good enough, and what do you gain by giving up exactness?"
    ],
    "ticketing": [
      "Why do ticket booking systems put a temporary hold on seats?",
      "A huge concert goes on sale and a million people try to buy 50,000 tickets in the first minute. How would you keep the system up and prevent double booking?",
      "Compare using database transactions with row locks versus a distributed lock for reserving seats."
    ],
    "kv-store": [
      "How does a distributed key-value store decide which nodes store a given key?",
      "One replica of a key is unreachable during a write. How can hinted handoff and quorum writes keep the store available and correct?",
      "What are the trade-offs of vector clocks versus last-write-wins for resolving conflicting writes?"
    ],
    "payments": [
      "Why do payment systems use a double-entry ledger?",
      "Your call to the card processor times out and you don't know if the charge went through. What should the system do?",
      "Why do payment systems run reconciliation jobs, and what is the trade-off between reconciling in real time and daily?"
    ],
    "ood": [
      "How should you approach a low-level object-oriented design question in an interview?",
      "Sketch the main classes and their relationships for a parking lot that has different spot sizes and vehicle types.",
      "When can following SOLID principles too strictly make a design worse?"
    ],
    "testing": [
      "What is the testing pyramid, and why is it shaped that way?",
      "A test passes on your laptop but fails randomly in CI about one run in ten. What might cause it, and how would you fix it?",
      "What are the pros and cons of using mocks in unit tests?"
    ],
    "code-review": [
      "What makes a pull request easy to review?",
      "A senior engineer leaves a review comment you disagree with. How would you handle it?",
      "What is the trade-off between long-lived feature branches and trunk-based development with small, frequent merges?"
    ],
    "incidents": [
      "Why should you mitigate an incident before finding its root cause?",
      "You're on call and error rates spike right after a deploy. Walk through what you would do.",
      "What makes a postmortem useful, and why should it be blameless?"
    ]
  };

  const api = { LESSON_QUIZZES };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof globalThis !== "undefined" ? globalThis : this);
