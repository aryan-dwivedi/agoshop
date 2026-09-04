# Live commerce platform verification plan

## Core acceptance path

1. Browse/search a category and open a product detail page.
2. Check a serviceable and non-serviceable PIN code, compare two products and add a variant to cart.
3. Verify upcoming, live and ended sessions appear in discovery.
4. As seller, start a session and publish a source; as shopper, join and exchange chat messages.
5. Start the voice assistant in a live room and ask catalog, comparison, delivery, payment and pricing questions.
6. Add an attached product via the assistant and verify `LIVE20` is applied only while the session is live.
7. End the show and verify the open cart reprices and the replay has no live discount.
8. Verify recording/transcript replay, seller moderation and analytics views.

## Automated checks

Run `npm run typecheck`, `npm run lint`, and `npm test`. The integration suite covers commerce, live-session lifecycle, AI tool execution, seller catalog boundaries and support handoff against PostgreSQL and Redis.
