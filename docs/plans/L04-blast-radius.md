# L04 — Blast Radius: карта впливу зміненого коду

**Статус:** реалізовано 2026-08-13. Розділ «Що змінилося проти плану» в кінці
фіксує чотири розходження — три з них знайдені на реальних даних уже після того,
як усі тести були зелені.

Продовження гілки `homework-L04` і того самого PR
[#6](https://github.com/teplyakoff/dev-digest/pull/6) — README (рядок L04) уже
називає Blast Radius другою половиною цього уроку, а уточнення ментора прив'язує
демо `get_blast_radius` до здачі MCP-сервера. Розділяти на два PR означало б
лишити інструмент і роут, який він викликає, у різних PR.

**Запит.** Показати рев'юеру, «що ще може зачепити цей diff»: символи, оголошені
у змінених файлах → їхні викликачі → HTTP-ендпоінти, які від них залежать.
Джерело фактів — **виключно** персистентний індекс `repo-intel`. Модель у
основному сценарії не викликається, і це структурна властивість, а не обіцянка в
коментарі.

**Пакети.** `server/` (**pnpm**) — новий модуль `blast/`, розширення фасаду
`RepoIntel`, контракти · `client/` (**pnpm**) — вкладка Blast · `mcp/` (**npm**)
— заміна чесної заглушки на реалізацію · `demo/` (**npm**) — перезйомка
`record-mcp` + новий `record-blast` · корінь (README, docs/results/l04).

---

## Зафіксовані рішення

| # | Рішення | Обґрунтування |
|---|---|---|
| 1 | Новий модуль `server/src/modules/blast/`, роут `GET /pulls/:id/blast` | Конвенція сервера: фіча = папка `modules/<name>/` + один рядок у `modules/index.ts`. `repo-intel/routes.ts` — це роути **репозиторію**, а blast ключується PR-ом |
| 2 | Blast-модуль ходить **тільки** через `container.repoIntel` (інтерфейс), ніколи через `RepoIntelRepository` | `server/CLAUDE.md`: «Need another module's data? Use `container.*`. Do not import from a sibling module's folder» |
| 3 | Обхід зворотного графа — **новий метод фасаду** `getDependents(repoId, files, depth)`, не запит із blast-сервісу | Наслідок №2: SQL по `file_edges` живе в `repo-intel/repository.ts`, а blast бачить лише рядки |
| 4 | **Без fallback на ripgrep.** Немає індексу → `degraded`, а не «повільна, але повна відповідь» | Критерій приймання: «Сервер не перебудовує AST та імпортний граф під час запиту». Наявний fallback (`service.ts:300`) читає клон і парсить — див. F2 |
| 5 | `status: 'full' \| 'partial' \| 'degraded'` у відповіді, з `reason` | `BlastResult` знає лише булеве `degraded` (F5). `partial` мусить бути окремим станом, інакше «неповний індекс» неможливо відрізнити від «індексу нема» |
| 6 | Клік `файл:рядок` → github.com blob по `head_sha` | Викликачі за визначенням **не в diff-і** — вбудований diff-viewer їх не має. `githubBlobUrl` (`client/src/lib/github-urls.ts:26`) уже будує `#L{n}` і вже пінить sha |
| 7 | Опційне LLM-резюме **не робимо** | Основний сценарій лишається доказово безмодельним; нема чого рейт-лімітувати, нема витрат, які демо мусило б виправдовувати |
| 8 | MCP-інструмент ключується PR-ом (`pull_request`), не `repo`+`path` | Домашка: «використовуючи той самий серверний маршрут». Роут PR-ключований — вхід інструмента мусить бути таким самим, інакше це другий, розбіжний контракт |

---

## Знахідки перевірки (прочитати до імплементації)

### F1 — заглушка сама описала порядок робіт

`mcp/src/tools/get-blast-radius.ts:36-38`: «Implementing it for real is a
two-part change in a later lesson: add the route on the server, then replace this
body. **Both, in that order.**» План це поважає: крок 9 не починається, доки
кроки 1–3 не дали 200.

### F2 — фасад уже вміє blast, але дешевий шлях там НЕ дешевий

`RepoIntel.getBlastRadius` оголошено (`repo-intel/types.ts:147`) і реалізовано
(`service.ts:229`). Всередині — дві гілки:

- персистентна `tryPersistentBlast` (`service.ts:324`) — чистий SQL, підходить;
- fallback (`service.ts:245-312`) — `container.codeIndex.symbols()`,
  `references()`, а далі `readClone` + `extractEndpoints` **у циклі по файлах
  викликачів** (`service.ts:299-303`).

Другий шлях порушує критерій «не перебудовує AST та імпортний граф під час
запиту» буквально. Тому blast-сервіс **спершу** читає `getIndexState`, і якщо
статус не `full`/`partial` — повертає `degraded` не викликавши
`getBlastRadius` взагалі. Fallback лишається на місці для інших споживачів
(prompt-assembly), не видаляємо.

### F3 — ендпоінти зараз беруться не з графа імпортів

У `tryPersistentBlast` `impactedEndpoints` складаються з `file_facts` **файлів
прямих викликачів** (`service.ts:385-391`). Це один рівень і йде через
`references`, а не через `file_edges`. Домашка (крок 5) вимагає саме зворотний
граф імпортів з обходом на два рівні. `file_edges` існує
(`db/schema/repo-intel.ts:55`, `fromFile` імпортує `toFile`), наповнюється
`depgraph.buildEdges` (`pipeline/full.ts:223-224`), і читається лише цілком —
`getEdges(repoId)` (`repository.ts:432`). Потрібен новий, вужчий запит.

### F4 — ліміт «20 викликачів» застосовано не там

`MAX_CALLERS_PER_SYMBOL = 20` (`constants.ts:19`) документовано як «caller
fan-out cap **per changed symbol**», а застосовано до всього плаского списку:
`callers.slice(0, MAX_CALLERS_PER_SYMBOL)` (`service.ts:395`). PR, що змінює
п'ять символів, віддає 20 рядків на всіх — і символи в хвості сортування
виглядають як такі, що не мають викликачів. Домашка (крок 4) вимагає
«обмежте результат до 20 викликачів **на символ**». Виправляємо в
`tryPersistentBlast`: групування за `viaSymbol`, сортування за `rank` DESC
всередині групи, зріз по 20 у кожній.

### F5 — у контракті немає стану `partial`

`BlastResult` має `degraded?: boolean` + `reason?: DegradedReason`
(`types.ts:74-96`), а `IndexState.status` — повний набір
`full | partial | degraded | failed` (`types.ts:33`). Відповідь роута мусить
нести саме `status`, зведений з обох джерел, інакше «індекс неповний» і «індексу
нема» приходять на клієнт однаково.

### F6 — тест MCP наразі закріплює протилежне

`mcp/test/tools.test.ts:306-318` стверджує: `ALWAYS fails, invents nothing` і
`expect(api.calls).toEqual([])`. Цей тест переписується у кроці 9 — він не
«ламається», він виконав свою роль.

### F7 — бюджет токенів MCP

`mcp/README.md` фіксував **1 871 виміряний токен** на п'ять інструментів при
стелі **2 000** (`README.md:223`). Опис заглушки — чотири рядки; реальний опис
буде не коротшим. Після заміни **обов'язково** переміряти серіалізований
`tools/list` і оновити число в README. Якщо вийшли за 2 000 — це дефект, і
різатимемо описи інших інструментів, а не піднімемо стелю.

### F8 — контракти вендоряться, і це три кроки

`server/src/vendor/shared/contracts/` — джерело; `client/src/vendor/shared/` —
згенерована копія. Правка → `./scripts/vendor-shared.sh` → **обидві** копії в
одному коміті. `--check` у workflow `lint` і pre-PR гейт `vendor-sync` падають
на дрейфі.

### F9 — demo-PR уже існує і підходить

PR #4 (`demo/contract-break`) змінює `toRepoDto` у
`server/src/modules/repos/helpers.ts` — спільний хелпер із трьома
крос-файловими посиланнями в `repos/service.ts` (рядки 92, 102, 107), а
`repos/routes.ts` імпортує `service.ts` і реєструє чотири ендпоінти. Тобто
ланцюг `helpers.ts ← service.ts ← routes.ts` — рівно два рівні зворотного
графа, з ендпоінтами на другому. Новий demo-PR не потрібен.

---

## Форма відповіді

Новий контракт у `server/src/vendor/shared/contracts/review-api.ts` (поруч із
`SmartDiffResponse`, `review-api.ts:148`). Наявний `BlastRadius` у `brief.ts:58`
**не чіпаємо** — то шматок PR Brief з полем `summary` під модель; наш роут
віддає індексні факти й `summary` не має.

```ts
BlastEndpoint   = { route, file, path_len }        // "GET /repos", хто його оголошує, дистанція 1|2
BlastCaller     = { file, symbol, line, rank }
BlastSymbol     = { name, file, kind, callers: BlastCaller[], callers_total }
BlastResponse   = {
  status: 'full' | 'partial' | 'degraded',
  reason: string | null,                            // заповнене тільки коли не full
  changed_files: string[],
  symbols: BlastSymbol[],
  endpoints: BlastEndpoint[],
  crons: string[],
  indexed_sha: string | null,
  counts: { symbols, callers, endpoints },          // для заголовка вкладки
}
```

`callers_total` окремо від `callers.length` — щоб «показано 20 із 47» було
чесним рядком, а не мовчазним зрізом.

---

## Кроки

### Крок 1 — фасад: зворотний граф

`server/src/modules/repo-intel/`

1. `repository.ts` — `getReverseEdges(repoId, toFiles: string[]): Promise<{fromFile, toFile}[]>`:
   `SELECT from_file, to_file FROM file_edges WHERE repo_id = $1 AND to_file = ANY($2)`.
   Один запит на рівень, не на файл.
2. `types.ts` — у `RepoIntel` додати
   `getDependents(repoId, files, depth?): Promise<DependentRow[]>`, де
   `DependentRow = { file, depth, endpoints, crons }`.
3. `service.ts` — реалізація: BFS назад, `depth` за замовчуванням `BFS_DEPTH`
   (`constants.ts:38` = 2), вихідні файли виключено з результату, цикли
   зупиняються множиною `seen`, факти дочитуються одним `getFileFacts` по
   всіх зібраних файлах.
4. Там само — виправити F4: ліміт 20 **на символ**.

*Перевірка:* `cd server && pnpm typecheck` · новий юніт-тест на BFS (цикл
A→B→A, глибина 3 не повертає нічого понад 2, вихідний файл не в результаті).

### Крок 2 — контракти

1. Дописати схеми у `server/src/vendor/shared/contracts/review-api.ts`.
2. `./scripts/vendor-shared.sh`, обидві копії в коміт (F8).

*Перевірка:* `./scripts/vendor-shared.sh --check` мовчить.

### Крок 3 — модуль `blast/`

`server/src/modules/blast/` — `routes.ts` · `service.ts` · `constants.ts`.

- `routes.ts`: `GET /pulls/:id/blast`, `schema: { params: IdParams, response: { 200: BlastResponse } }`.
  Без рейт-ліміту — нуль токенів, індексовані читання (та сама аргументація, що
  в `smart-diff/routes.ts:26-30`). Перший рядок хендлера — `getContext`,
  перший рядок сервісу — `getPull(workspaceId, prId)`: тенантність доводиться
  до будь-якого читання (форма IDOR-захисту зі `smart-diff/routes.ts:20-25`).
- `service.ts`:
  1. `getPull` → 404 чужого/неіснуючого PR;
  2. `container.reviewRepo.getPrFiles(prId)` → змінені файли;
  3. `repoIntel.getIndexState(repoId)` → якщо не `full`/`partial`, повертаємо
     `status: 'degraded'` з причиною і **не** йдемо далі (F2);
  4. `repoIntel.getBlastRadius(repoId, changedFiles)` → символи + викликачі;
  5. `repoIntel.getDependents(repoId, changedFiles)` → ендпоінти/крони з
     дистанцією;
  6. складання відповіді; `status: 'partial'`, якщо індекс `partial` **або**
     жодного символу не знайдено при непорожньому diff-і.
- Один рядок у `modules/index.ts`.

*Перевірка:* `pnpm test` (юніти сервісу на трьох станах: full / partial /
degraded, з мок-`RepoIntel` — саме для цього споживачі кодуються проти
інтерфейсу) · руками `curl :3001/pulls/<uuid>/blast`.

### Крок 4 — вкладка Blast

`client/src/app/repos/[repoId]/pulls/[number]/_components/BlastTab/`
(+ `helpers.ts`, `styles.ts`, тест — без `index.ts`, `client/INSIGHTS.md:257`).

- `src/lib/hooks/blast.ts` — свій доменний файл, ключі приватні, **не**
  ре-експортується з `hooks/index.ts` (`client/INSIGHTS.md:310`).
- Вкладка в `PrDetailHeader` (`tabs={[...]}`, рядок 115) + гілка в
  `PrDetailView` поруч із `tab === "diff"`; стан у query-рядку, як усе інше.
- Ієрархія: змінений символ → викликачі → ендпоінти. Кожен рядок викликача —
  посилання `githubBlobUrl(repoFullName, pr.head_sha, file, line)`, ціль
  `_blank`.
- Три стани: `degraded` (пояснення + кнопка «Re-analyze» на наявний
  `POST /repos/:id/resync`), `partial` (банер «індекс неповний, показано що є»),
  порожній результат при `full` (окремий текст — «зв'язків не знайдено» ≠ «нема
  даних»).

*Перевірка:* `pnpm typecheck && pnpm lint && pnpm test` у `client/` · живий
браузер: клік по кожному `файл:рядок` відкриває саме той рядок.

### Крок 5 — MCP-інструмент

`mcp/src/tools/get-blast-radius.ts` — вхід `{ pull_request, symbol? }`,
резолвер PR той самий, що в `get_findings`. Виклик `GET /pulls/:id/blast` через
`ApiClient` (додати метод в інтерфейс **і** у `fake-client.ts` — обидва, інакше
дублер дрейфує). Вихід — стислий текст: статус, символи з їхніми викликачами
(зріз), ендпоінти. `degraded` → `isError: true` з причиною, не порожній список.

Переписати `mcp/test/tools.test.ts:301-319` (F6). Переміряти й оновити токени в
`mcp/README.md` (F7).

*Перевірка:* `cd mcp && npm run typecheck && npm test` · `npx @modelcontextprotocol/inspector tsx src/index.ts`
→ Connect → List Tools → виклик.

### Крок 6 — демо та документація

1. `demo/record-mcp.ts` — кадр `09-call-blast-radius-error.png` стає
   `09-call-blast-radius.png` з успішною відповіддю; `summary.json`
   перегенерується сам.
2. `demo/record-blast.ts` (+ `record:blast` у `package.json`) — вкладка Blast на
   PR #4, розкриття символу, клік по `файл:рядок`.
3. `docs/results/l04/` — нові кадри; README-рядок L04 більше не називає
   інструмент заглушкою; `server/README.md` — новий роут у мапі API;
   `mcp/README.md` — інструмент і токени.

*Перевірка:* `cd demo && npm run record:mcp && npm run record:blast` — обидва
проходять на чистому старті (`./scripts/dev.sh`).

### Крок 7 — здача

`/pr-self-review` → вердикт мусить бути не-BLOCKED, інакше `.claude/hooks/pr-guard.sh`
не пустить push. Далі — опис у PR #6 і два відео.

---

## Критерії приймання → де вони закриваються

| Критерій | Крок | Чим доводиться |
|---|---|---|
| Відкритий PR з описом і відео | 7 | PR #6 + `docs/results/l04/` |
| На demo-PR ≥2 реальних викликачі й ≥1 ендпоінт | 3, 4 | PR #4: `toRepoDto` → 3 посилання в `service.ts` → 4 ендпоінти в `routes.ts` (F9) |
| Клік `файл:рядок` відкриває рядок | 4 | `githubBlobUrl(..., head_sha, file, line)`, перевірено в браузері |
| Сервер не перебудовує AST/граф під час запиту | 3 | Гейт на `getIndexState` **до** будь-якого читання; fallback недосяжний (F2) |
| Зрозумілий empty state | 4 | Окремий текст для «нема зв'язків» при `full` |
| Окремий стан `partial`/`degraded` | 2, 3, 4 | `status` у контракті (F5), три гілки у вкладці |
| Основний сценарій без LLM | 3 | У `blast/service.ts` немає шляху до `container.llm` — структурно, як у Smart Diff |
| `get_blast_radius` віддає стислий структурований результат | 5 | Той самий роут, переписаний тест |
| Inspector показує 5 інструментів, усі працюють | 6 | `record-mcp.ts`, кадри 04 і 06–09 |

---

## Поза межами

- Опційне LLM-резюме карти (рішення №7).
- Граф-вигляд («Tree | Graph» на макеті) — віддаємо дерево; граф не є критерієм.
- «Prior PRs touching these files» з макета — це PR History, інша фіча (L05).
- `SourceReader` port для `repo-intel` (відомий борг, `service.ts:29-34`) —
  цей план його не чіпає й не поглиблює.
- Видалення ripgrep-fallback з `getBlastRadius`: у нього лишаються інші
  споживачі.

## Відкриті питання

1. **Що робити, коли `references.decl_file` не резолвнувся.** Персистентний шлях
   свідомо точний (`service.ts:320-322`): неоднозначне посилання не
   стверджується як викликач. Для PR, де хелпер має однойменні тезки, це виглядає
   як «викликачів нема». Варіант — рахувати такі окремо й показувати рядком
   «N неоднозначних посилань не показано». Не вирішено; за замовчуванням —
   поточна точність.
2. **Чи показувати крони поруч з ендпоінтами.** `file_facts` їх уже має
   (`db/schema/repo-intel.ts:82-83`), макет показує `reset-rate-buckets (hourly)`.
   Віддаємо в контракті (`crons`), рендеримо, якщо непорожньо.

---

## Що змінилося проти плану

Чотири розходження. Три з них знайдені на **реальних даних** — після того, як
323 серверні й 199 клієнтських тестів були зелені, а роут повертав валідний JSON.
Це і є головний висновок цієї роботи: набір тестів, зібраний із власних уявлень
про дані, підтверджує лише ці уявлення.

### 1. Довелося додати `getFileFacts` на фасад (крок 1)

План мав один новий метод — `getDependents`. Але обхід за побудовою виключає
вхідні файли, а на demo-PR ендпоінти оголошує саме `repos/routes.ts`, який **сам
є зміненим файлом**. Тобто карта показувала б нуль ендпоінтів там, де їх чотири.
Звідси другий метод і `depth: 0` у контракті: «названо у зміненому файлі» — це
інший тип твердження, ніж «за два кроки вниз графом», і UI мусить їх розрізняти.

### 2. `parseReferences` не бачив символ, переданий як значення

`toRepoDto` викликається у `repos/service.ts` тричі; карта показувала одного
викликача. Третій виклик — `rows.map(toRepoDto)`, де символ є **аргументом**, а
викликається `map`. AST-обхід дивився тільки на «голову» виклику, тож цей шаблон
не існував для індексу взагалі.

Виправлено в `adapters/astgrep/index.ts` (обхід аргументів виклику) і в
`adapters/codeindex/extract.ts`, чий docstring три уроки стверджував, що шаблон
там є. Точність тримає не фільтр, а `resolveReferences`: непорезолвлене
посилання ніколи не стає викликачем. `INDEXER_VERSION` піднято до 3, бо індекс
v2 не помилковий — він **короткий**, а «менше рядків» на боці читання виглядає
рівно як «менше викликачів».

Критерій приймання вимагає ≥2 реальних викликачі; без цієї правки їх було 1.

### 3. Посилання `файл:рядок` пінилося не до того коміта

Рішення №6 казало «github.com blob по `head_sha`». Це неправильно: номери рядків
рахує індексер проти `indexed_sha`, і head PR-а — інший коміт. Посилання на head
веде туди, де **зараз** стоїть той номер рядка. На demo-PR обидва збігаються
(файл викликача не змінювався між комітами), тобто баг був би невидимим саме на
демо і виліз би на файлі, який зсунувся. Тепер пініться до `indexed_sha`.

### 4. Ендпоінти depth 0 включають виклики клієнта, і це залишено свідомо

`extractEndpoints` матчить `api.get('/repos')` так само, як `app.get('/repos')`,
тож серед depth-0 є рядки з `client/src/lib/hooks/core.ts`. Спокуса — відфільтрувати.
Не зроблено: demo-PR перейменовує `POST /repos/:id/refresh`, і саме клієнтський
хук, який його викликає, **і є** та зламана сторона контракту. Замість фільтра
уточнено формулювання: секція називається «HTTP routes this change touches»,
depth 0 — «in a changed file», а не «declared in».

### Дрібніше

- Ліміт «20 викликачів на символ» (F4) виправлено, як і планувалося; додано
  `MAX_SYMBOLS = 50` на сам список символів, чого в плані не було.
- Токени MCP: 1 871 → **1 936** із 2 000. Реальний інструмент коштує на 54
  токени більше за заглушку; запас у 64 токени названо вголос у `mcp/README.md`.
- Рекордер `record-blast.ts` **виходить за localhost** — сцена 4 переходить за
  посиланням у github.com і перевіряє, куди потрапила. Знімок посилання довів би
  наявність тега `<a>`, а не робочий deep link.
