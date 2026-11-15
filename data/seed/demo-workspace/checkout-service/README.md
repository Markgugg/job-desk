# Demo checkout service

A fictional demo project. Nothing here describes real work; it exists so the
Evidence tab has something to scan on a fresh install.

## What it does

The service takes a cart, prices it, and hands payment to a provider. Prices
are cached in Redis and orders are stored in Postgres.

## Results

- Load tests sustained 1,200 requests per second with p95 latency under 180 ms.
- Moving price lookups into Redis cut checkout time by 35%.
- The test suite runs 240 tests in CI on every pull request.
