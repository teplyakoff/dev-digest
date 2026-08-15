# L04 — `devdigest-mcp`: локальний stdio MCP-сервер

**Статус:** план, v1. Не звірений із зовнішнім списком практик користувача (зображення ще не надійшло).

**Запит.** Додати шостий standalone-пакет `mcp/` із п'ятьма MCP-інструментами
(`list_agents`, `run_agent_on_pull_request`, `get_findings`, `get_conventions`,
`get_blast_radius`) поверх stdio, як тонкий HTTP-адаптер до наявного REST API на
`http://localhost:3001`.

**Пакети.** `mcp/` (новий, **npm**) · `server/` (**pnpm**) — тільки читання контрактів
плюс одне виправлення docstring · корінь (`.github/workflows/`, `.claude/`, docs).

---

## Зафіксовані рішення

| # | Рішення | Обґрунтування |
|---|---|---|
| 1 | Окремий пакет `mcp/`, stdio→HTTP. **Без пулу Postgres, без `Container`, без `~/.devdigest/secrets.json`** | stdio-сервер — один процес на клієнта; прямий доступ до БД дав би N пулів і N копій секретів |
| 2 | `get_blast_radius` — чесна заглушка: `isError: true`, без фейкових даних і без виклику `repoIntel` | див. F3: HTTP-роута для blast radius не існує взагалі |
| 3 | `run_agent_on_pull_request` — **блокуючий**, але повертає компактне зведення + `run_id`; деталі через `get_findings` | вибір користувача; мітигація контекстного роздування |
| 4 | Гнучкий резолвер ідентифікаторів: URL / `owner/repo`+номер / UUID | Anthropic: семантика замість UUID |
| 5 | `max_wait_seconds` **default 900** | «Справді блокуючий». Життєздатність тримається на progress notifications + `extra.signal` — див. нижче |
| 6 | `.mcp.json` **комітиться**, `--strict-mcp-config` документується | Деліверабл уроку має бути видимим. Ціна названа вголос у README |
| 7 | Рядок `mcp` у `routing.md` — **у цьому ж PR** | Без нього `mcp/src/**` не рев'юїться нічим. Приймаємо один холодний прохід рев'ю |

---

## Кільця всередині `mcp/` (звірено зі скілом onion-architecture)

Скіл §15 оголошує себе авторитетом для `server/` і `reviewer-core/`; `mcp/` — ні те, ні інше,
тож застосування — свідоме рішення. `routing.md` забороняє лише одне: «`onion-architecture`
never runs on `client/`». Обмеження «тільки server» там нема, тож група `mcp` з цим скілом
законна.

Застосовуємо §9 і §4 буквально:

| Кільце | Файли в `mcp/` |
|---|---|
| **1 — контракти й порти** | `src/api/types.ts` — **інтерфейс `ApiClient`**, вихідні форми інструментів, таксономія помилок |
| **2 — use cases** | `src/usecases/run-review.ts`, `src/usecases/collect-findings.ts`, `src/usecases/read-conventions.ts` |
| **3 — адаптери й транспорт** | `src/api/http-client.ts` (реалізація), `src/api/fake-client.ts` (дублер), `src/tools/*.ts` (driving adapter) |
| **RC** | `src/main.ts`, `src/server.ts`, `src/config.ts` |

**Чому ring 2 тут не церемонія.** §9: *«One line of orchestration per handler. If a handler has
a `for` loop, a `try/catch` around business logic, or two awaits that depend on each other,
that body is a service.»* Хендлер `run_agent_on_pull_request` робить резолв → резолв → POST →
цикл полінгу → дочитування findings → складання зведення. Це шість залежних кроків і цикл —
за §9 це сервіс, а не хендлер. Те саме для `get_findings` (резолв → вибірка → union усіх
`kind: 'review'` → фільтр → пагінація).

**Де ring 2 БУВ БИ церемонією — і тому його там нема.** §13: *«A service that only forwards to a
repository»* — антипатерн. `list_agents` і `get_blast_radius` лишаються тонкими хендлерами:
один виклик клієнта і проєкція, відповідно константна відповідь.

**`ApiClient` — порт, не клас.** §4 вимагає чотирьох правок на кожну зовнішню систему:
інтерфейс (ring 1) → реалізація (ring 3) → тестовий дублер → ключ інʼєкції. У плані було
`client.ts` + `fake-client.ts` без інтерфейсу — це §13 «інтерфейс без дублера навпаки»:
дублер без інтерфейсу. Обидва мусять `implements ApiClient`, інакше зміна форми клієнта не
ламає дублер на компіляції, і фікстури тихо дрейфують.

**Що з цього НЕ застосовне.** §8 (репозиторії), §15 «чотири місця правки» для `SecretsProvider`
і `ContainerOverrides` — усе це про `server/`. `mcp/` не має ні БД, ні секретів, ні контейнера.

---

## Знахідки перевірки (прочитати до імплементації)

### F1 — docstring у репо бреше, і на ньому тримається весь блокуючий дизайн

`server/src/vendor/shared/contracts/review-api.ts:40-44` стверджує, що
`POST /pulls/:id/review` повертає reviews «once the (synchronous) run completes».

Реалізація — fire-and-forget:

```ts
// server/src/modules/reviews/service.ts:132-137
// Fire-and-forget: the HTTP response returns now with the runIds; reviews
// are persisted as each agent finishes and the client refetches on SSE done.
void this.executor.executeRuns(workspaceId, pull, repo, jobs, logger).catch(...);
return { runs, reviews: [] };
```

`reviews` **завжди `[]`**. Блокування треба будувати в адаптері. Виправлення
docstring — супутня зміна (S10).

### F2 — роут `POST /pulls/:id/review`, однина

`server/src/modules/reviews/routes.ts:27-28`, з `rateLimit: { max: 10, timeWindow: '1 minute' }`.
Множина `/pulls/:id/reviews` — це **читання** (`routes.ts:129`).

### F3 — HTTP-ендпоінта для blast radius не існує

Фасад є (`server/src/modules/repo-intel/types.ts:147`, реалізація `service.ts:229`,
контракт `BlastResult` — `types.ts:74`), але `repo-intel/routes.ts` реєструє лише
`/repos/:id/index-state` і `/repos/:id/resync`. Тобто заглушка — не лише продуктове
рішення: викликати нема чого. Майбутній урок міняє тіло хендлера **і** додає роут.

### F4 — barrel `reviewer-core` тягне OpenAI SDK

`reviewer-core/src/index.ts:81` реекспортує `OpenRouterProvider`. `wrapUntrusted`
імпортувати **підшляхом** `@devdigest/reviewer-core/prompt.js` — `prompt.ts` імпортує
лише тип із `@devdigest/shared` плюс чистий `./skills.js`.

---

## Інваріанти під ризиком

| Інваріант | Як цей пакет може його зламати | Джерело |
|---|---|---|
| `INJECTION_GUARD` на кожному шляху рев'ю | `mcp/` не має складати промпт і не має викликати модель. Виклик моделі тут = новий review-шлях без гарду | `reviewer-core/src/prompt.ts:197-198` |
| Секрети не торкаються БД і git | Тримається безкоштовно: локальний API без авторизації, тримати нема чого | `server/src/modules/_shared/context.ts` |
| Grounding обов'язковий, score рахується з тих, що вижили | `mcp/` віддає `score` як прочитав, ніколи не перераховує і не переранжовує | `AGENTS.md:48-50` |
| `*.it.test.ts` = DB-backed | **Не використовувати цей суфікс у `mcp/`** — жоден тест тут не працює з БД | `AGENTS.md:56`, `TESTING.md:79-83` |

## INSIGHTS.md, що зв'язують цю роботу

**Корінь** (робота торкається `.claude/`, `scripts/`, docs):

1. `INSIGHTS.md:115-127` — **фактичні передумови плану не перевіряє ніщо, і хибна проходить усі гейти.** Зароблено просто тут: F1.
2. `INSIGHTS.md:154-160` — скіл цитується шляхом, ніколи голою назвою.
3. `INSIGHTS.md:129-138` — верифікаційний скрипт, який не показали червоним, доказом не є.

**`server/`:**

1. `server/INSIGHTS.md:343-356` — **один рядок у `reviews` = один АГЕНТ, не один прохід рев'ю.**
   `reviews.find(r => r.review.kind === 'review')` показав **0 findings на PR, де їх було 13**.
   `get_findings` мусить об'єднувати **всі** рядки `kind: 'review'`. Найбільший ризик коректності в плані.
2. `server/INSIGHTS.md:38-64` — прогони на **945 с і 674 с** проти типових 8–99 с;
   `POST /runs/:id/cancel` **не перериває** запит у польоті. Звідси `max_wait_seconds` і заборона авто-скасування.
3. `server/INSIGHTS.md:170-185` → `server/src/app.ts:81` — `buildApp` реапає `running` прогони при конструюванні.
   Не запускати серверний сьют, поки живий прогін виконується.

Також: `server/INSIGHTS.md:66-71` — у сідованих PR `patch: null`, тому живу перевірку
run-інструмента робити на справді імпортованому репозиторії, не на сіді.

---

## Рішення з обґрунтуванням

**npm, не pnpm.** (1) `.claude/skills/pr-self-review/scripts/_lib.sh:69-77`: `psr_pm()` —
`server|client → pnpm`, `*) → npm`; npm потребує **нуля** правок. (2) `server/INSIGHTS.md:160-168`:
на pnpm 11 усе падає з `ERR_PNPM_IGNORED_BUILDS` без `pnpm-workspace.yaml` з `allowBuilds:` —
дерево залежностей MCP SDK саме такого класу. (3) Прецедент: усе, крім двох довгограючих серверів, — npm.

**Контракти через tsconfig alias, ніколи третьою вендореною копією.**
`reviewer-core/tsconfig.json:21-26` — робочий прецедент, разом із **самопіном zod**
(`"zod": ["./node_modules/zod"]`) — це мітигація дубльованих інстансів zod, зафіксованих
у `server/src/app.ts:138-142`. `mcp/` пінить `zod@^3.24.1`.

**Полінг `GET /pulls/:id/runs`, не SSE.** (1) POST і так одразу віддає run id (F1).
(2) `RunBus` — in-memory (`server/src/platform/sse.ts:20-25`): рестарт API рве стрім,
а `agent_runs.status` усе одно осідає. (3) `{ all: true }` дає N прогонів — один полінг
відповідає за всі, SSE вимагав би N з'єднань. (4) Нуль додаткових залежностей.

Термінальні статуси: `done | failed | cancelled` (`trace.ts:132`; пишуться в
`run-executor.ts:166, 502, 593-602`). `GET /pulls/:id/runs` повертає **всі** прогони PR —
полер мусить фільтрувати за id, які повернув POST.

**`max_wait_seconds`: default 900** (рішення користувача — «справді блокуючий»). Верхня межа
зафіксованого прогону — 945 с (`server/INSIGHTS.md:52-64`), тож 900 покриває майже все.
**Не скасовувати автоматично** — cancel не перериває запит у польоті.

Довгий default створює один конкретний ризик — **клієнт відвалиться раніше за нас**, і тоді
діагностика буде гіршою, ніж при власному таймауті. Дві мітигації, обидві підтверджені на
типах SDK 1.30.0:

1. **Progress notifications.** `RequestHandlerExtra.sendNotification` існує
   (`shared/protocol.d.ts:201-205`), а `_meta` несе `progressToken` (`types.d.ts:49`).
   `RequestOptions` на клієнті має **`resetTimeoutOnProgress`** (`protocol.d.ts:83`) поряд із
   `timeout` і `maxTotalTimeout`. Тобто якщо клієнт передав `progressToken`, кожен тік полінгу
   шле progress — і клієнти з `resetTimeoutOnProgress: true` **скидають свій таймаут**. Це те,
   що робить 15-хвилинний блокуючий виклик життєздатним, а не теоретичним.
2. **`extra.signal`** (`protocol.d.ts:177`) — AbortSignal скасування з боку клієнта. Полер
   мусить його слухати і зупинятись негайно, повертаючи `run_id`. Без цього 15-хвилинний
   виклик неперериваний, що гірше за будь-який таймаут.

Обидві вимагають, щоб дескриптор інструмента прокидав третій аргумент:
`server.registerTool(t.name, t.config, (i, extra) => t.handler(i, deps, extra))`.

**`get_conventions` лишається інструментом, без `resource_link` у L04.** Resource
адресується URI, що передбачає, що викликач уже знає repo id — а гнучкий резолвер
(рішення 4) це саме workflow, тобто робота інструмента. Дані також не статичні:
`POST /repos/:id/conventions/extract` замінює набір. Натомість: компактний список
кандидатів за замовчуванням, повне тіло скіла (`ConventionSkillDraft.body`, необмежене,
`knowledge.ts:451-471`) — за `include_skill_draft: true`.

**Рівно один інструмент оголошує `outputSchema`** — `run_agent_on_pull_request`
(вона мала, і модель мусить надійно прочитати `run_id` при таймауті). Решта чотири
повертають `content`. `get_findings` свідомо без схеми: `Finding` (`findings.ts:47-62`)
— 12 полів плюс два масиви.

---

## Кроки

### S1 — Скелет пакета
Файли: `mcp/package.json` · `mcp/tsconfig.json` · `mcp/eslint.config.js` ·
`mcp/vitest.config.ts` · `mcp/README.md` · `mcp/AGENTS.md` · `mcp/CLAUDE.md` (**симлінк**) ·
`mcp/INSIGHTS.md`.
Скіли: `.claude/skills/security/SKILL.md` (A03 Supply Chain), `.claude/skills/typescript-expert/SKILL.md`.

- `package.json`: `@devdigest/mcp`, `private: true`, `type: module`; скрипти дзеркалять
  `reviewer-core/package.json:8-13`; залежності `@modelcontextprotocol/sdk@1.30.0`, `zod@^3.24.1`.
- `tsconfig.json`: копія `reviewer-core/tsconfig.json` + аліас підшляху reviewer-core
  (`server/tsconfig.json:24-25`):
  ```jsonc
  "paths": {
    "@devdigest/shared":          ["../server/src/vendor/shared/index.ts"],
    "@devdigest/shared/*":        ["../server/src/vendor/shared/*"],
    "@devdigest/reviewer-core/*": ["../reviewer-core/src/*"],
    "zod":   ["./node_modules/zod"],   // пін дубльованих інстансів, app.ts:138-142
    "zod/*": ["./node_modules/zod/*"]
  }
  ```
- `vitest.config.ts`: **ті самі аліаси в `resolve.alias`** — vitest не читає tsconfig `paths`.
  Шаблон: `reviewer-core/vitest.config.ts:4-12`.
- `eslint.config.js`: правило, що забороняє `console.log`/`info`/`debug` і
  `process.stdout.write` у `src/**`. На stdio stdout — канал протоколу.
- `CLAUDE.md` комітиться режимом `120000` на голу назву `AGENTS.md` —
  `.github/workflows/agents-md.yml:48-59` перевіряє саме режим.

Перевірка: `cd mcp && npm install && npm run typecheck && npm run lint`;
`git ls-files -s mcp/CLAUDE.md` → `120000`.
Ризик: аліаси в tsconfig, але не у vitest — typecheck зелений, тести падають на імпорті.

### S2 — HTTP-клієнт, мапінг помилок, конфіг, stderr-логер
Файли: `mcp/src/config.ts` · `mcp/src/log.ts` · `mcp/src/api/client.ts` ·
`mcp/src/api/errors.ts` · `mcp/src/api/fake-client.ts`.
Скіли: `onion-architecture` §10 (адаптери транслюють; помилки бібліотек не йдуть усередину),
`security` (A02 Misconfiguration).

- `config.ts` читає `DEVDIGEST_API_URL` (default `http://localhost:3001`) і **відхиляє
  будь-який не-loopback хост** — тільки `localhost`, `127.0.0.1`, `::1`. API без авторизації,
  тож помилковий base URL — це шлях ексфільтрації без жодної перевірки перед ним.
- `errors.ts` мапить `ApiErrorBody` (`platform.ts:313-320`, продукується `server/src/app.ts:116-164`):
  `validation_error` → 422 з `details`; `AppError` → свій код/статус; `internal_error` → 500.
  Плюс **429** (rate limit на `POST /pulls/:id/review`) і `ECONNREFUSED` →
  «the DevDigest API is not running; start it with `./scripts/dev.sh`».
- Кожен збій → `{ content: [{ type: 'text', text }], isError: true }`, ніколи не throw.
- `fake-client.ts` живе в `src/`, не в `test/` — onion §12: тестові дублери це продакшн-код.

Перевірка: `cd mcp && npm test -- api`.

### S3 — Резолвер ідентифікаторів
Файли: `mcp/src/resolve.ts` · `mcp/test/resolve.test.ts`. Скіл: `zod` (`safeParse` на межі).

`resolvePull(ref, api)` / `resolveRepo(ref, api)` приймають URL, `owner/repo`+номер, або UUID.
Шлях: `GET /repos` → матч `Repo.full_name` (`platform.ts:159`) → `repo.id`;
`GET /repos/:id/pulls` → матч `PrMeta.number` (`platform.ts:190`) → `pr.id`.
**`PrMeta.id` — `z.string().nullish()` (`platform.ts:189`)**: null має давати дієвий
`isError`, не краш. Список репо мемоїзується на процес; список PR — ні.
При промаху текст помилки **перелічує кандидатів, які він бачив** — це те, що дає моделі самокорекцію.

Ризик: тихе резолвення в чужий репо за однаковим `full_name` у двох workspace →
тест на дублікат мусить давати помилку неоднозначності, а не вибір.

### S4 — Бутстрап сервера і `list_agents` (еталонна реалізація)
Файли: `mcp/src/main.ts` · `mcp/src/server.ts` · `mcp/src/tools/list-agents.ts` · `mcp/src/tools/index.ts`.
Скіли: `onion-architecture` §9 (**«Jobs, streams, and CLIs are transport too»** — саме це
правило робить рішення 1 таким, що можна перевірити), `zod`.

Ім'я сервера — **`devdigest`** (коротке: кожен виклик платить `mcp__devdigest__<tool>`).
`instructions` **опущено**.

```ts
// mcp/src/tools/list-agents.ts
export const ListAgentsInput = z.object({
  enabled_only: z.boolean().default(true)
    .describe('Only agents that are switched on. false also returns disabled ones.'),
  include_prompt: z.boolean().default(false)
    .describe('Include each agent system prompt. Expensive — prompts run to hundreds of lines.'),
}).strict();

export const listAgents = {
  name: 'list_agents',
  config: {
    title: 'List review agents',
    description: [
      'List the DevDigest review agents in this workspace: name, provider, model, enabled,',
      'and how many skills each has linked.',
      'Use this first to choose the `agent` argument for run_agent_on_pull_request,',
      'or to find which agent produced a finding.',
      'Do NOT use this to edit an agent or read its version history — neither is exposed here.',
      'Examples: list_agents({}) → enabled agents.',
      'list_agents({ enabled_only: false, include_prompt: true }) → everything, verbose.',
    ].join('\n'),
    inputSchema: ListAgentsInput,   // повна об'єктна схема → .strict() застосовується
    annotations: { readOnlyHint: true, openWorldHint: false, idempotentHint: true },
    // без outputSchema → хендлер повертає `content`
  },
  handler: async (input: z.infer<typeof ListAgentsInput>, deps: Deps) => { /* … */ },
} as const;
```

Реєстрація — цикл у `server.ts`:
`for (const t of TOOLS) server.registerTool(t.name, t.config, (i) => t.handler(i, deps))`.
`include_prompt: false` **пропускає `system_prompt`** — найбільший токен-важіль цього інструмента.

Ризик: `.default()` не застосовується, бо SDK валідує до хендлера → парсити схему і
всередині хендлера теж (дешево, і робить хендлер тестованим окремо).

### S5 — `get_findings`
Файли: `mcp/src/tools/get-findings.ts` · `mcp/src/format.ts`.

Композиція: резолвер + `GET /pulls/:id/reviews` (`reviews/routes.ts:129`).
**Об'єднати кожен рядок `kind: 'review'`** — `server/INSIGHTS.md:343-356`.

Вхід (плаский, `.strict()`): `pull_request`, `severity` (enum `CRITICAL|WARNING|SUGGESTION`,
`findings.ts:11`), `category` (enum `bug|security|perf|style|test`, `findings.ts:14`),
`path_contains`, `status` (enum `open|accepted|dismissed|all`, default `open`),
`limit` (default 20, max 100), `offset`, `response_format` (`concise|detailed`, default `concise`).

`concise` = рядок на finding: `SEVERITY category file:start-end — title`.
`detailed` додає `rationale` і `suggestion`.
`format.ts` тримає `CHARACTER_LIMIT` і самообрізку, чиє повідомлення **називає точні
параметри**, що звужують запит.

### S6 — `get_conventions`
Файл: `mcp/src/tools/get-conventions.ts`.
Резолвер репо + `GET /repos/:id/conventions` (`conventions/routes.ts:40`) → `ConventionsView`
(`knowledge.ts:439-443`). Проєкція: `category`, `rule`, `status`, `evidence_path:start-end`.
Вхід: `repo`, `status` (enum `ConventionStatus`, `knowledge.ts:370`, default `accepted`),
`category`, `limit`/`offset`, `include_skill_draft` (default `false`).
Ризик: `scan: null` (ніколи не екстрактили) виглядає як «конвенцій нема» → окреме
дієве повідомлення з посиланням на `POST /repos/:id/conventions/extract`.

### S7 — `get_blast_radius` (чесна заглушка)
Файл: `mcp/src/tools/get-blast-radius.ts`.
Зареєстрований, видимий, `readOnlyHint: true`. Хендлер **завжди** повертає `isError: true`
з текстом, що це нереалізована точка розширення, і вказує на `get_findings` як доступну
альтернативу. **Не** викликає `repoIntel.getBlastRadius`, нічого не вигадує.
Коментар у коді фіксує F3: фасад є, HTTP-роута нема, майбутній урок додає роут **і** міняє тіло.
Тести: `isError === true`; інструмент присутній у `TOOLS` (видимий, не схований).

### S8 — `run_agent_on_pull_request` (блокуючий)
Файли: `mcp/src/tools/run-agent.ts` · `mcp/src/poll.ts`.

Єдиний інструмент із `readOnlyHint: false, openWorldHint: true, idempotentHint: false,
destructiveHint: false`. Опис у своїх 3–6 рядках мусить сказати, що він **іде в GitHub
і в LLM і витрачає гроші**, і що типова латентність — десятки секунд, але буває ~15 хвилин.

Послідовність: резолв PR → резолв `agent` (ім'я або id) через `GET /agents` →
`POST /pulls/:id/review` з `RunRequest` (`platform.ts:307-310`: `{ agentId }` або `{ all: true }`)
→ зібрати `runs[].run_id` → полінг `GET /pulls/:id/runs` (`reviews/routes.ts:101`),
**відфільтрований за цими id**, поки кожен не стане `done|failed|cancelled` → зведення
з `RunSummary` (`trace.ts:126-148`) плюс топ-N findings із `GET /pulls/:id/reviews`.

Backoff 2 с → 5 с → 10 с, стеля 10 с. `max_wait_seconds` **default 900**, max 900.

На кожному тіку полінгу: якщо `extra._meta?.progressToken` присутній — слати progress через
`extra.sendNotification`; якщо `extra.signal.aborted` — негайно припинити і повернути `run_id`.
Обидва шляхи покриваються тестами з фейковими таймерами.

Зведення тільки компактне: `run_id`, `status`, `agent_name`, `score`, `blockers`,
лічильники за severity, `cost_usd`, `duration_ms`, топ-N (default 5) findings **по рядку
на кожен**. Ніколи повний дамп — для цього є `get_findings`, і опис має це казати.

При таймауті: `isError: true` з усіма `run_id` та інструкцією викликати `get_findings`.
**Не скасовувати.**

Тести: фейковий клієнт `running → running → done` → зведення і очікувана послідовність
викликів; клієнт, що ніколи не виходить із `running` → `isError` з run id у межах
`max_wait_seconds`. **Нуль реального HTTP, нуль витрат.** Фейкові таймери.

Ризик: полінг без фільтра завершується на `done` **попереднього** прогону →
фікстура з одним старим `done` і одним новим `running`.

### S9 — Недовірений контент у всіх результатах
Файли: `mcp/src/format.ts` + усі п'ять модулів інструментів.
Скіл: `.claude/skills/security/SKILL.md` (ASI09 Trust Exploitation, ASI01 Goal Hijacking).

**Це нова поверхня атаки, і вона заслуговує на окремий крок.** `INJECTION_GUARD` захищає
модель **рев'ю** (`reviewer-core/src/prompt.ts:197-198`); він нічого не робить для тексту,
що тече назад через MCP у модель **викликача**. Заголовки й обґрунтування findings,
заголовки PR, `evidence_snippet` конвенцій — усе походить із чужих PR.

Обгортати кожен такий фрагмент через `wrapUntrusted`, імпортований підшляхом:
`import { wrapUntrusted } from '@devdigest/reviewer-core/prompt.js'` (F4).
`wrapUntrusted` уже нейтралізує спроби закрити власний делімітер (`prompt.ts:66-70`).
Коментар у `mcp/src/server.ts`: у цей пакет ніколи не можна додавати складання промпту
чи виклик моделі.

Тест: finding, у чиєму `title` є `</untrusted>` і `Ignore previous instructions` →
делімітер нейтралізовано, фрагмент обгорнуто.
Ризик: імпорт barrel замість підшляху → `openai` у дереві. Сигнал: `grep -c openai mcp/package-lock.json`.

### S10 — Інтеграція в репо: CI, гейти, роутинг, докси, launch-конфіг
Файли: `.github/workflows/mcp.yml` · `.claude/skills/pr-self-review/scripts/_lib.sh` ·
`.claude/skills/pr-self-review/scripts/gates.sh` · `.claude/skills/pr-self-review/routing.md` ·
`AGENTS.md` · `TESTING.md` · `README.md` ·
`server/src/vendor/shared/contracts/review-api.ts` (тільки docstring) ·
`.mcp.json` · `mcp/bin/devdigest-mcp`.

- `mcp.yml`: форма `reviewer-core.yml` (node 22, `cache: npm`,
  `cache-dependency-path: mcp/package-lock.json`, `npm ci` → `typecheck` → `test`).
  `paths:` мусить включати `mcp/**`, **`server/src/vendor/shared/**`** і
  **`reviewer-core/src/prompt.ts`** — обидва зааліасені всередину.
- `_lib.sh`: додати `mcp/*) echo mcp ;;` у `psr_package()` (`:56-67`).
  `psr_pm()` **не чіпати** — його `*)` вже npm.
- `gates.sh`: **пʼять циклів, не чотири** (перевірено на файлі):
  `:130` npm-пакети (`reviewer-core e2e demo` → додати `mcp`; `:127` — це pnpm-список,
  його НЕ чіпати), `:141` lock-drift, **`:295` lint**, `:296` typecheck, `:300` test.
  Цикл lint у попередній редакції плану був пропущений. Оновити коментар
  «Five packages, two managers» (`_lib.sh:~69`) на шість.
- `routing.md` §1: рядок `mcp` → `mcp/**` → `onion-architecture` §9/§10 + `typescript-expert`,
  may block. **Не** `frontend-architecture`. Без цього рядка `mcp/src/**` не матчить жодну
  групу і не рев'юїться нічим.
- Лічильники в доксах: `AGENTS.md:20` «five standalone packages» + таблиця `:22-28`;
  `TESTING.md:3` «four independent packages» (вже застаріле) + мапа сьютів `:27-34`;
  `README.md` таблиця пакетів і рядок L04.
- Виправити docstring F1. Це `server/src/vendor/shared/**` — **джерело**, редагується
  правильно там, — але треба прогнати `./scripts/vendor-shared.sh` і закомітити **обидві копії**.
- `mcp/bin/devdigest-mcp`: shell-обгортка, що резолвить власний каталог
  (`ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"`) і exec'ить локальний `tsx`
  на `src/main.ts`. Це робить запуск незалежним від cwd клієнта, що і дає резолвитись tsconfig `paths`.
- `.mcp.json` — **комітиться** (рішення користувача), плюс `mcp/README.md` документує
  `--strict-mcp-config` для сесій, яким ці інструменти не потрібні:
  ```json
  { "mcpServers": { "devdigest": {
      "command": "mcp/bin/devdigest-mcp",
      "args": [],
      "env": { "DEVDIGEST_API_URL": "http://localhost:3001" } } } }
  ```
  Наслідок, який треба назвати вголос у `mcp/README.md`: ~1 650 токенів додаються до **кожної**
  агентської сесії в цьому репо, включно з `planner`, `researcher` і рев'ю-агентами, яким ці
  інструменти не потрібні. Це і є причина, чому токен-бюджет нижче — не косметика.

Перевірка:
```
./scripts/vendor-shared.sh --check
git ls-files -s mcp/CLAUDE.md          # очікується 120000
bash .claude/skills/pr-self-review/scripts/gates.sh
grep -c openai mcp/package-lock.json   # очікується 0
```
Ризик: цикл у `gates.sh` виправлено в одному місці й пропущено в іншому → лейн тихо не
виконується. За `INSIGHTS.md:129-138` довести, що кожен новий лейн уміє почервоніти:
підсадити падаючий тест, прогнати `gates.sh`, побачити один FAIL, відкотити, звірити байтову ідентичність.

---

## Наскрізна перевірка

Герметично, нуль HTTP і нуль витрат:
```
cd mcp && npm ci && npm run typecheck && npm run lint && npm test
./scripts/vendor-shared.sh --check
bash .claude/skills/pr-self-review/scripts/gates.sh
```

Живою, один раз, і це **витрачає гроші** — run-інструмент єдине, чого герметичний сьют не доводить:
1. `./scripts/dev.sh` (потрібен Docker; міграції на бут не йдуть — `pnpm db:migrate` при `relation ... does not exist`).
2. Імпортувати **справжній** репо і PR. Не сід: у сідованих PR `patch: null`.
3. Підключити сервер і викликати по черзі: `list_agents` → `get_conventions` →
   `run_agent_on_pull_request` (один агент, не `all`) → `get_findings` → `get_blast_radius` (очікується `isError`).
4. **Не запускати серверний сьют, поки крок 3 у польоті** — `buildApp` реапне живий оплачений прогін у `failed`.
5. Виміряти реальну вартість контексту через `/context` у свіжій сесії і звірити з оцінкою нижче.

---

## Токен-бюджет

Оцінка, не вимір. Визначення інжектяться в системний промпт кожного чату.

| Інструмент | Назва | Опис | Input | Output | Annot. | Разом |
|---|---:|---:|---:|---:|---:|---:|
| `list_agents` | ~9 | ~110 | ~90 | — | ~15 | **~225** |
| `run_agent_on_pull_request` | ~12 | ~170 | ~200 | ~150 | ~15 | **~550** |
| `get_findings` | ~9 | ~130 | ~250 | — | ~15 | **~405** |
| `get_conventions` | ~9 | ~110 | ~150 | — | ~15 | **~285** |
| `get_blast_radius` | ~10 | ~90 | ~70 | — | ~15 | **~185** |
| | | | | | | **~1 650** |

Бюджет: **2 000 токенів**. Перевищення — дефект, а не факт життя.

Важелі, за спаданням сили:
1. **Рівно п'ять інструментів.** Кожен наступний — ~200–550.
2. **`instructions` опущено.** П'ять описів уже несуть маршрутну інформацію, яку воно б повторило.
3. **Один `outputSchema`**, тільки на `run_agent_on_pull_request`. На `get_findings` він
   коштував би ~400 за форму `Finding`.
4. **Пласкі схеми** — без вкладених обʼєктів, отже без `$defs` у згенерованій JSON Schema.
5. **`enum` замість вільних рядків** — усі беруть членів із наявних контрактів.
6. **Ім'я сервера `devdigest`.**
7. Описи не довші за шість рядків, включно з двома прикладами.

Окремо, на відповідь: `CHARACTER_LIMIT` у `mcp/src/format.ts`. Чесно про різницю одиниць:
Claude Code ріже відповіді на ~25 000 **токенів**, а символьний ліміт — те, що адаптер може
дешево забезпечити. При ~4 символах на токен `CHARACTER_LIMIT = 25_000` символів ≈ 6 000
токенів, комфортно всередині. Первинні контролі — `response_format: 'concise'` і `limit: 20`;
обрізка — запобіжник, чиє повідомлення називає параметри звуження.

---

## Поза скоупом

- Remote / HTTP transport (`streamableHttp.js` у SDK є — у L04 тільки локальний stdio).
- Будь-яка автентифікація. API — `LocalNoAuthProvider`; авторизація в MCP була б театром.
- Публікація `@devdigest/mcp` у npm — `private: true`, як усі пакети тут.
- **Справжня реалізація blast radius** — потребує двох речей, яких тут нема: нового HTTP-роута (F3) і заміни тіла хендлера.
- Будь-який UI. **Але твердження «жоден файл `client/` не чіпається» — хибне:** виправлення
  докстрінга F1 у `server/src/vendor/shared/contracts/review-api.ts` розповсюджується на
  `client/src/vendor/shared/contracts/review-api.ts` через `vendor-shared.sh`, і **обидві
  копії треба закомітити**, інакше `--check` у `lint.yml:49` червоніє. Змінюється саме
  згенерована копія контрактів, жодного коду UI.
- Нові серверні роути, сервіси, репозиторії, міграції.
- Зміна `POST /pulls/:id/review` на синхронний — це зачепило б і веб-клієнт.
- Виправлення того, що `reviewer-core/test/**` не матчить жодну routing-групу (передіснуюче).
- Прогін `/pr-self-review` — обов'язковий перед PR, але окрема фаза зі своїм гейтом.

## Неперевірені припущення

1. **`structuredContent` на шляху `isError`.** План каже, що при таймауті
   `run_agent_on_pull_request` повертає `content` + `isError: true` без `structuredContent`.
   Чи SDK **дозволяє** `structuredContent` поруч з `isError` і чи валідує його проти
   `outputSchema` при помилці — не підтверджено. Обрана форма консервативна.
   Знімається за пʼять хвилин на S8.
2. **Резолвення відносного `command` у `.mcp.json`.** Чи Claude Code резолвить його від
   кореня проєкту — не підтверджено. Обгортка `mcp/bin/devdigest-mcp` робить *сервер*
   незалежним від cwd незалежно від цього. Знімається на першому підключенні; фолбек — абсолютний шлях.
3. **Наявність `InMemoryTransport`.** Стратегія тестів S4 свідомо його не потребує.
