# @monorepo-template/infra-db — Package Spec

```
src/
├── client/
├── config/
├── enums/
├── mappers/
├── repositories/
├── schema/
└── utils/
```

---

## `client/`

| Item                        | Kind     | Description                                                |
| --------------------------- | -------- | ---------------------------------------------------------- |
| `db`                        | const    | Pre-configured Drizzle client using `DATABASE_URL` env var |
| `createDatabaseClient(url)` | function | Factory that creates a new Drizzle client from a given URL |

---

## `config/`

| Item           | Kind  | Description                                           |
| -------------- | ----- | ----------------------------------------------------- |
| `TABLE_PREFIX` | const | `"monorepo_template"` — prefix for all DB table names |

---

## `enums/`

| Item               | Kind   | Description                                            |
| ------------------ | ------ | ------------------------------------------------------ |
| `currencyEnum`     | pgEnum | PostgreSQL enum for currencies (from domain constants) |
| `todoStatusEnum`   | pgEnum | PostgreSQL enum for todo statuses                      |
| `todoPriorityEnum` | pgEnum | PostgreSQL enum for todo priorities                    |
| `todoCategoryEnum` | pgEnum | PostgreSQL enum for todo categories                    |

---

## `utils/`

| Item          | Kind     | Description                                                                       |
| ------------- | -------- | --------------------------------------------------------------------------------- |
| `createTable` | function | `pgTableCreator` wrapper that auto-prefixes table names with `monorepo_template_` |
| `timestamps`  | const    | Reusable column object with `createdAt`, `updatedAt`, `deletedAt`                 |

---

## `schema/`

### `auth.ts`

| Item                | Kind      | Description                                                      |
| ------------------- | --------- | ---------------------------------------------------------------- |
| `userTable`         | table     | Users (id, name, email, emailVerified, image, timestamps)        |
| `sessionTable`      | table     | Sessions (id, expiresAt, token, ipAddress, userAgent, userId FK) |
| `accountTable`      | table     | OAuth accounts (accountId, providerId, tokens, userId FK)        |
| `verificationTable` | table     | Verification codes (identifier, value, expiresAt)                |
| `userRelations`     | relations | User → many sessions, accounts, todos                            |
| `sessionRelations`  | relations | Session → one user                                               |
| `accountRelations`  | relations | Account → one user                                               |

### `todo.ts`

| Item            | Kind      | Description                                                                       |
| --------------- | --------- | --------------------------------------------------------------------------------- |
| `todoTable`     | table     | Todos (id, title, description, status, priority, category, userId FK, timestamps) |
| `todoRelations` | relations | Many-to-one with user                                                             |
| `Todo`          | type      | Inferred SELECT type                                                              |
| `NewTodo`       | type      | Inferred INSERT type                                                              |

---

## `mappers/`

| Item                               | Kind          | Description         |
| ---------------------------------- | ------------- | ------------------- |
| `TodoMapper.toDomain(row)`         | static method | DB row → `TodoBase` |
| `TodoMapper.toPersistence(entity)` | static method | `TodoBase` → DB row |

---

## `repositories/`

| Item                                       | Kind   | Description                                                            |
| ------------------------------------------ | ------ | ---------------------------------------------------------------------- |
| `TodoRepository`                           | class  | Implements `ITodoRepository`                                           |
| `.findById(id, userId)`                    | method | Find by ID + userId, excludes soft-deleted                             |
| `.findPaginated(userId, params, filters?)` | method | Paginated list with status/priority filters, ordered by updatedAt DESC |
| `.save(todo)`                              | method | Insert new todo                                                        |
| `.update(id, userId, data)`                | method | Update fields, sets updatedAt, returns updated entity                  |
| `.delete(id, userId)`                      | method | Soft delete (sets deletedAt)                                           |

---

## Totals

| Category           | Count |
| ------------------ | ----- |
| Files              | 12    |
| Exported classes   | 2     |
| Exported functions | 2     |
| Exported constants | 2     |
| pgEnums            | 4     |
| Drizzle tables     | 5     |
| Exported types     | 7     |
