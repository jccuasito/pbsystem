---
name: pbsystem-backend-crud
description: Use this skill whenever creating or modifying a Nitro server API route, a server/utils/*Crud.ts helper, or any MySQL query in the DJA Payroll & Billing System (pbsystem) project. Applies to every new backend resource (CRUD endpoints), migrations, and anything touching server/api or server/utils.
---

# pbsystem Backend CRUD Pattern

This project has an established, working pattern across `organizationCrud.ts` and
`rateCrud.ts`. Follow it exactly for every new backend module — do not invent a new
pattern per module.

## Hard rules (violating these has caused real bugs before)

1. **Reserved MySQL words must be backticked, everywhere.** `position` is a reserved
   word in this schema and must appear as `` `position` `` in every SQL string — SELECT,
   INSERT, UPDATE, DELETE, and inside the `table:` field of any resource config object.
   Missing even one occurrence causes a runtime "Server Error" with no useful message.
   Before finishing any task, grep the diff for the word `position` used as a bare table
   reference and confirm it's backticked.

2. **Import paths must match actual folder depth — count the `../` manually.**
   `server/utils/*.ts` → `pool` is at `../connection/dbconnect` (one level up to `server/`,
   then into `connection/`).
   `server/api/<module>/<resource>.<method>.ts` → utils are at `../../utils/<file>`.
   `server/api/<module>/<sub>/<resource>.<method>.ts` → utils are at `../../../utils/<file>`.
   Do not guess; count folder levels from the actual file location to `server/`, then back
   down. A wrong path fails the whole dev server build (RollupError), not just one route.

3. **Every protected endpoint starts with `const session = requireSession(event)`**
   from `server/utils/auth.ts`. Never write a new auth check. If the session subject isn't
   needed, write `void session.sub` to satisfy lint, matching existing files.

4. **All queries are parameterized** via `pool.execute<any[]>(sql, [params])`. Never
   concatenate user input into SQL strings, including for dynamic `ORDER BY` or resource
   whitelisting — build those from a fixed whitelist object/array, never from raw input.

5. **Soft delete, not hard delete, unless the table has no Status column.** Standard
   pattern: `UPDATE <table> SET Status = 'Inactive' WHERE <id> = ?`. If a table lacks a
   `Status` column (e.g. `region` originally did), add one via migration first — don't
   invent a different deactivation mechanism.

6. **Whitelisted `:resource` pattern for grouped CRUD.** When several related tables share
   the same CRUD shape (see `organizationCrud.ts`, `rateCrud.ts`), use one dynamic
   `[resource].get.ts` / `.post.ts` / `.put.ts` / `.delete.ts` set of Nitro routes backed by
   a `Record<Resource, Config>` map in a `server/utils/<module>Crud.ts` file, rather than
   writing a separate route file per table. Only break this pattern (dedicated route files)
   when a resource has meaningfully different logic (transactions, multi-table writes,
   business validation) — see `employeeCrud.ts` for an example of mixing both approaches
   in one module.

7. **Multi-step writes use a transaction.** Get a connection with
   `const connection = await pool.getConnection()`, `beginTransaction()`, do all writes on
   `connection` (not `pool`), `commit()` on success, `rollback()` in catch, `release()` in
   finally. Required whenever a single logical action touches more than one table (e.g.
   client_rate linking payroll_rate + billing_rate, or DTR auto-creating a deployment).

8. **No placeholder/dummy values to satisfy a NOT NULL constraint.** If real operations
   require creating a record before some field is known (e.g. an employee before a badge
   number is assigned), the fix is to make that column nullable via migration — never
   generate a placeholder string like "NOID001". Flag this to the user if you notice a
   NOT NULL constraint blocking a legitimate workflow, rather than working around it silently.

## Standard file layout for a new grouped-CRUD module

```
server/utils/<module>Crud.ts       # Resource configs, list/create/update/delete functions
server/api/<module>/[resource].get.ts     -> defineEventHandler(list<Module>Resource)
server/api/<module>/[resource].post.ts    -> defineEventHandler(create<Module>Resource)
server/api/<module>/[resource].put.ts     -> defineEventHandler(update<Module>Resource)
server/api/<module>/[resource].delete.ts  -> defineEventHandler(delete<Module>Resource)
```

## After every change

Update `docs/API_MAP.md` with: method, path, tables touched, which `.vue` file/component
calls it, and the request/response shape. Keep it current — it is the map another session
(or the developer) reads to understand what already exists before building the next module.