# Repository status

## Product currently present

This repository contains **SYM POS**, a browser-based restaurant point-of-sale
application. Its runtime is an Express API with a TypeScript browser client,
and its persistence options are in-memory repositories or PostgreSQL.

The implemented domains are restaurant operations: authentication and RBAC,
menu and table management, ordering, kitchen/bar queues, billing, inventory,
reports, audit history, synchronization, and printer integrations.

## Explore Myanmar v0.10 milestone audit

The requested Explorer Progression milestone cannot be safely implemented in
this checkout because the Explore Myanmar game is not present. In particular,
the repository has none of the milestone's prerequisite systems or artifacts:

- no Yangon or Bagan world, quest, journal, photography, luggage, travel, or
  avatar implementation;
- no Rapier or other game runtime dependency;
- no `GameLLMService`, OpenAI adapter, DeepSeek adapter, NPC memory, or game
  intent implementation;
- no Prisma schema, Prisma dependency, or Prisma migration history; and
- no existing `README.md` material describing Explore Myanmar to extend.

The only occurrences of “Yangon” are POS test fixtures for the `Asia/Yangon`
timezone and a restaurant store identifier. They are not game content.

Consequently, there is no current vertical slice to play or audit and no
canonical player/discovery/quest data from which to design a compatible,
server-authoritative progression migration. Creating unrelated game systems
inside this POS application would risk the working product and would violate
the requirement to evolve, rather than replace, existing game content.

## Milestone status

**Blocked pending the correct Explore Myanmar repository or branch.** No
Explorer XP, Explorer Score, discovery, achievement, destination progress,
quest, Bagan unlock, or reconciliation implementation is claimed complete.
No database reset or modification has been performed.

Once the correct source is available, the v0.10 work should begin with the
required full-journey audit and schema review, followed by a real additive
Prisma migration and an implementation based on the game's canonical events.

