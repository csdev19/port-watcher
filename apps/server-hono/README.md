# Hiring Tool Server

## Setup

```
bun install
```

We have to create a `.dev.vars` file in the root of the project.

```
cp .dev.vars-example .dev.vars
```

If we want to deploy to Cloudflare Workers from local machine, we have to set up the environment variables.

```
wrangler secret put DATABASE_URL
wrangler secret put BETTER_AUTH_SECRET
wrangler secret put BETTER_AUTH_URL
```

## Run the server

```
bun run dev
```

## Deploy the server

```
bun run deploy
```
