# ssot2026
Solo Somos Otros Tenaces 2026

# install

```sh
> npm install
> npm run build
> npm start
```

## Capture the backend SSOT

Keep the sibling `../system-definition` checkout available with its core and
`consumers/postgres-migrations` packages built. Dependencies use those local packages.

```sh
npm run migration:capture
npm run migration:capture -- --out dist/system-snapshot.json
```

The command builds this backend and captures the records and entities from
`src/backend/system.ts` as JSON (`{ok, value}`). It does not connect to PostgreSQL
or modify the database.
