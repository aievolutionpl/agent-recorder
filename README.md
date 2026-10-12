# Agent Recorder

Agent Recorder to windows-first, open-source aplikacja Electron dla zespołów, które chcą nagrywać ekran i jednocześnie obserwować przebieg pracy agenta AI. Lokalny odbiornik zdarzeń działa na loopback, zapisuje JSONL w `userData` i pokazuje bezpieczną, filtrowalną oś sesji.

Projekt rozwija fork Recordly przygotowany przez AI Evolution Polska. Zachowujemy licencję AGPL-3.0 oraz wymagane informacje o Recordly i OpenScreen — zobacz [ATTRIBUTION.md](ATTRIBUTION.md).

Repozytorium: <https://github.com/aievolutionpl/agent-recorder>

## Najważniejsze możliwości

- nagrywanie i edycja ekranu odziedziczone z Recordly;
- lokalny odbiornik `POST /events` na losowym porcie loopback;
- JSON oraz JSONL, opcjonalny bearer token, redakcja sekretów i usuwanie chain-of-thought;
- live timeline: tool call/result, browser action, nawigacja, screenshot, notatka i błąd;
- eksport/import protokołu JSONL w module `src/features/agent-session`;
- kontrastowy interfejs AI Evolution Polska: `#0E1330`, `#5B4DFF`, `#2FA8FF`, bez gradientów i glow.

## Szybki start

Wymagane: Node.js 20+, npm oraz zależności systemowe Electron. Na Windows rekomendowany jest PowerShell.

```bash
git clone https://github.com/aievolutionpl/agent-recorder.git
cd agent-recorder
npm install
npm run dev
```

Kontrole lokalne:

```bash
npm test -- electron/agent-events
npm run typecheck
npm run lint
npm run build
```

`npm run build` uruchamia także natywne helpery platformowe. Jeżeli środowisko nie ma toolchainu Windows/macOS, uruchom przynajmniej testy, typecheck i lint.

## Wysyłanie zdarzeń

Port jest losowany przy każdym uruchomieniu. Adres endpointu i status są widoczne w panelu Agent Session. Przykład z `curl`:

```bash
curl -X POST http://127.0.0.1:PORT/events \
  -H "Content-Type: application/json" \
  -d '{"type":"tool_call","sessionId":"demo","timestamp":"2026-10-12T09:00:00.000Z","source":"codex","toolName":"read_file"}'
```

PowerShell:

```powershell
$event = @{ type = "note"; sessionId = "demo"; timestamp = (Get-Date).ToUniversalTime().ToString("o"); message = "Agent started" } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:PORT/events" -ContentType "application/json" -Body $event
```

Token można włączyć przed startem aplikacji przez `AGENT_RECORDER_EVENT_TOKEN`. Odbiornik wtedy wymaga `Authorization: Bearer <token>`.

## Architektura

```text
Agent / CLI / browser hook
          │  HTTP JSON / JSONL
          ▼
127.0.0.1:random-port ── validation ── redaction + no-CoT
          │                         │
          ▼                         └── IPC subscription
userData/agent-events/*.jsonl ───────► React Agent Session panel
```

Szczegóły protokołu są w [docs/AGENT-EVENT-PROTOCOL.md](docs/AGENT-EVENT-PROTOCOL.md), a opis produktu w [docs/PRODUCT.md](docs/PRODUCT.md).

## Prywatność

Domyślnie dane nie opuszczają komputera. Serwer nasłuchuje wyłącznie na `127.0.0.1`, wydarzenia są sanityzowane przed zapisem, pola typu token/password/cookie są zastępowane przez `[REDACTED]`, a pola reasoning/thinking są usuwane. Nie zapisujemy chain-of-thought. Pamiętaj, że dane wejściowe narzędzi mogą zawierać informacje wrażliwe — używaj tokena i kontroluj pliki JSONL w katalogu danych aplikacji.

## Screenshots / Zrzuty ekranu

Brak zrzutów w repozytorium MVP. Poniższe miejsca są jawnie oznaczone placeholderami do uzupełnienia przed wydaniem:

- `[PLACEHOLDER: Agent Session panel]`
- `[PLACEHOLDER: recording HUD]`

## Roadmapa

Zobacz [docs/ROADMAP.md](docs/ROADMAP.md). MVP skupia się na lokalnym odbiorniku, bezpiecznej persystencji i użytecznej osi sesji; synchronizacja chmurowa i rozszerzone integracje są późniejsze.

## Licencja i podziękowania

Agent Recorder jest udostępniany na licencji **GNU Affero General Public License v3.0** — zobacz [LICENSE.md](LICENSE.md). Projekt zachowuje atrybucję Recordly oraz OpenScreen; pełna informacja znajduje się w [ATTRIBUTION.md](ATTRIBUTION.md).
