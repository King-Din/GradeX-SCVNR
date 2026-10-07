# B1 ↔ B2 Integration Contract

B2 owns all Google Sheets calls.

B1 requires these functions from B2:

```js
async function getUserById(id) {}
async function getUserByEmail(email) {}
async function getUsers() {}
```

## User shape

```js
{
  id: "U001",
  name: "Example User",
  email: "example@example.com",
  passwordHash: "$2b$12$...",
  role: "VOLUNTEER",
  domainId: "D001"
}
```

## Rules

1. `id` is a stable ID such as U001.
2. Email lookup should be case-insensitive.
3. `passwordHash` is available only to backend authentication code.
4. B1 never calls the Google Sheets API directly.
5. B2 should return `null` when a user does not exist.
6. B2 should throw an error for Google API failures rather than returning fake users.
