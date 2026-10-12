# Agent Event Protocol

## Transport

`POST http://127.0.0.1:<random-port>/events` przyjmuje pojedynczy JSON, tablicę JSON albo JSONL (`application/x-ndjson`). `GET /health` zwraca status i port. Serwer odrzuca połączenia spoza loopback i może wymagać `Authorization: Bearer <token>`.

## Zdarzenie

Minimalne pola to `type`, `sessionId` i `timestamp`. Obsługiwane typy to `session_start`, `session_end`, `tool_call`, `tool_result`, `browser_action`, `navigation`, `screenshot`, `file_action`, `terminal_action`, `note` i `error`. Dodatkowe pola są zachowywane po sanityzacji.

Przykład:

```json
{"type":"tool_result","sessionId":"demo","timestamp":"2026-10-12T09:00:01.000Z","source":"codex","toolName":"read_file","status":"success","durationMs":120}
```

## Prywatność i limity

Payload ma limit 1 MiB na request, event 256 KiB. Klucze sekretów oraz znane prefiksy kluczy są redagowane. Pola reasoning, thinking, chain-of-thought i podobne są usuwane przed JSONL. Odpowiedź `202` zawiera liczniki `accepted`, `rejected`, `redactions` i `strippedCot`.
