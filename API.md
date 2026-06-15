# BuildBorgBot API Documentation

## Authentication
All API requests (except webhooks) require the `x-titanium-api-secret` header.

## Endpoints

### Health Check
`GET /api/health`
Checks if the D1 database is accessible.

### Bots Config
`POST /api/factory/config`
Updates bot configuration.

`GET /api/factory/bots`
Lists all bots.

`PATCH /api/factory/bots/:bot_id`
Updates specific bot config.

`DELETE /api/factory/bots/:bot_id`
Deletes a bot.

### Memory
`GET /api/factory/memory`
Retrieves chat history.

`DELETE /api/factory/memory`
Deletes chat history.

`POST /api/factory/memory/summarize`
Summarizes chat history.

### Sequences
`GET /api/factory/sequences`
Lists sequences.

`POST /api/factory/sequences`
Upserts a sequence step.
