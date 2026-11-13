# Architecture and Effect v4 tasks

Tasks are ranked by data correctness and recovery first, operational resilience
second, and contracts and maintainability afterward. P1 tasks should be addressed
next, followed by P2 hardening and P3 improvements.

Keep the current service topology and SQL adapter package boundary. Include
behavioral tests for each implementation task's completion criteria.

1. [ ] **P1 — Prevent conflicting notebook writes**

   Add version-checked updates and explicit conflict responses. Make pinning a
   field-specific operation. Stale edits must not overwrite newer content or
   recreate deleted notes.

2. [ ] **P1 — Make filter semantics consistent**

   Enforce date ordering in the shared domain schema, including saved notes.
   Invalid URL filters must produce visible validation errors rather than an
   unfiltered query. Accept structured filters in Genie requests and assemble
   prompt context server-side.

3. [x] **P1 — Make Genie operations recoverable**

   Return conversation and message IDs after submission. Separate submission
   from polling and result retrieval. Allow failed result downloads to be retried
   without resubmitting the question, and retain recovery context across browser
   navigation.

   Implemented separate submission, status, and result endpoints, browser-session
   recovery, and result-download retries. `npm run test:architecture` covers
   recovery after navigation/reload and verifies that retries never resubmit.

4. [x] **P1 — Preserve error and interruption semantics**

   Introduce discriminated service errors and translate them to HTTP responses at
   the boundary. Replace blanket notebook `catchCause` handling. Isolate the
   PostgreSQL credential callback's infallibility constraint, preserve diagnostic
   causes, and keep interruption intact.

   Implemented tagged service errors with HTTP mapping at the router and a narrow
   PostgreSQL password adapter. Behavioral tests cover typed failures, diagnostic
   causes, defects, interruption, and safe HTTP error responses.

5. [x] **P2 — Isolate capability failures during startup**

   A temporary Lakebase discovery failure must leave analytics, the app shell,
   and health routes available. Invalid configuration must still fail clearly.
   Expose capability availability separately from configuration flags.

   Lakebase initialization is lazy, shared, and retried after discovery failures.
   Status exposes observed capability availability independently of configuration;
   invalid settings still fail startup. Offline tests exercise the real warehouse
   adapter during a discovery outage, and smoke checks verify shell and health
   routes after notebook failure over both HTTP protocols.

6. [x] **P2 — Add shared warehouse admission control**

   Bound warehouse work across distinct overview and trip requests. Queued work
   must respect cancellation and deadlines. Add a separate limit for concurrent
   Genie submissions.

   All metadata, overview, and trip statements share one per-process admission
   limit; Genie submissions use an independent limit. Deadlines include queue
   time, cancelled/expired waiters never start, and capacity is released after
   failures, defects, interruption, and cleanup. Offline behavioral tests cover
   distinct requests, queued cancellation, deadlines, and independent Genie reads.

7. [ ] **P2 — Make notebook listing complete and bounded**

   Replace the silent 200-note cutoff with pagination and explicit continuation
   metadata. Every saved note must remain reachable through the UI.

8. [ ] **P2 — Expand application verification and deployment gates**

   Add offline tests for conflicting notebook writes, filter invariants, Genie
   recovery, dependency outages, and admission control. Run the existing deployed
   API verification after startup; the app reporting `RUNNING` alone must not
   finish deployment verification.

9. [ ] **P2 — Model reproducible analysis context**

   Define a small shared model linking the dataset, filters, question or query,
   and result provenance. Let users preserve a Genie finding in the notebook and
   reopen its analysis context.

10. [x] **P3 — Unify the HTTP contract**

    Declare endpoints, inputs, outputs, and errors with `HttpApi`, and derive the
    client with `HttpApiClient`. Remove duplicated route and client definitions
    as endpoints migrate.

    All JSON endpoints, including health, now share `src/api.ts`. The server
    uses `HttpApiBuilder` and every browser API call uses `HttpApiClient`.
    Contract tests round-trip every endpoint, reject invalid inputs and outputs,
    and verify declared error decoding and cancellation during response reads.

11. [x] **P3 — Consolidate outgoing HTTP transport**

    Adopt Effect `HttpClient` where it removes repeated transport logic. Preserve
    separate policies for authenticated workspace requests and credential-free
    signed downloads. Retain cancellation and security tests.

    Workspace, SQL, OAuth, and generated browser requests now use Effect
    `HttpClient`, with scoped response lifetimes. Signed downloads omit
    credentials and trace propagation; upstream transports reject redirects.
    Tests cover credential isolation, redirect rejection, interruption,
    deadlines, token refresh recovery, and expired signed-link recovery.
    `npm run test:architecture` runs the app and adapter tests, builds the app,
    and checks browser recovery using the project's pinned Node 22 runtime.

12. [ ] **P3 — Complete observability integration**

    Configure trace export and consistent structured cause logging. Add
    visibility into queueing, cache behavior, credential refresh, and capability
    failures. Use named `Effect.fn` operations where they simplify tracing.
