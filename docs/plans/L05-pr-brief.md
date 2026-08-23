## Development Plan — L05 PR Why + Risk Brief

**Request:** реалізувати SPEC-07 — бриф PR (що змінює / де зламається) на сервері
й картку з переходом у диф на клієнті, прив'язавши кожен AC до кроку й до тесту.
**Spec:** `server/docs/specs/07-pr-brief.md` + `client/docs/specs/07-pr-brief.md`
— обидва `Spec ID: SPEC-07`, `Status: draft`, стан на комміті `464e9da`.
Повний перелік критеріїв — **об'єднання двох файлів**: AC-1…AC-35, AC-58…AC-68,
NFR-1…NFR-5, NFR-8 (сервер) + AC-36…AC-57, NFR-6, NFR-7 (клієнт) = 68 AC, 8 NFR.
**Packages:** `server/` (**pnpm**) · `client/` (**pnpm**). `reviewer-core/` —
тільки імпорт `INJECTION_GUARD`/`wrapUntrusted`, **жодних змін** (рішення спеки).
**Execution mode:** `single-agent`, **два послідовні прогони `/impl`** проти цього
плану (рішення власника; R-5).
**Ревізії плану:** (1) патч після крос-модельного рев'ю
(`docs/results/l05-homework/plan-cross-model-review.md`) — змінилися ролі кроків
S6, S7 і S8, див. **примітку про ротацію** на початку розділу *Steps*; прогін, що
піде за старим порядком, збере не той артефакт. (2) патч під **AC-68** (`464e9da`):
ризик без жодного посилання тепер відкидається — це поведінка, а не пом'якшення.
**Assumptions:**
1. Текст пов'язаного issue береться живим запитом через
   `container.intent.linkedIssueText(...)`, **без** правки `DeriveOutcome`
   (рішення власника на `[NEEDS CLARIFICATION]` «звідки береться текст issue»,
   default спеки).
2. Поріг 8 000 токенів авторизується виміром на кроці S8, а не приймається на
   віру (умова зупинки — там же).
3. `GET /pulls/:id/brief` **ніколи не будує** бриф; будує лише `POST`. Спека
   цього не каже жодним AC, але AC-67 (порожній бриф на читанні) і клієнтський
   AC-53 (порожній стан із закликом побудувати) разом не лишають іншого читання,
   і це дзеркало `GET /pulls/:id/intent` (`server/src/modules/intent/routes.ts:27-35`).

### Approach

Новий модуль `server/src/modules/brief/`, побудований за формою `modules/intent`:
collect (код) → assemble (код) → budget над **зібраними повідомленнями** (код) →
один структурований виклик → ground (код) → persist. Чужі дані модуль бере
**тільки через композиційний корінь**: `container.blast` (нове), `container.intent`
(наявне, плюс новий метод для тексту issue), `container.projectContext`,
`container.reviewRepo`, `container.tokenizer`. Сховище — наявна порожня таблиця
`pr_brief`, розширена ALTER-ом до колонкової форми `pr_intent`. Клієнт додає
презентаційну `PrBriefCard` над `briefGrid` на Overview і новий параметр URL
`?file=<path>`, який відкриває вкладку зі змінами з розгорнутою карткою файлу.

### Execution

**`single-agent`.** Один `implementer` бере кроки по порядку, сам пише тести,
названі в *Traceability*, і виконує *Verify* кожного кроку. Мультиагентний
розкид тут не має чого купити: `test-writer` виведено з потоку `/impl`
(root `INSIGHTS.md`, 2026-08-21), а треки не роз'єднані — контракт пише сервер,
читає клієнт.

**Два прогони, межа між ними жорстка.**

| Прогін | Кроки | Пакет | Починає з |
|---|---|---|---|
| **Прогін A** | S1 … S13 | `server/` (pnpm) | S1 |
| — межа — | `./scripts/vendor-shared.sh` виконано у S1 і перевірено у S13; **обидві копії контрактів закомічені** | — | — |
| **Прогін B** | S14 … S19 | `client/` (pnpm) | S14, маючи вже змерджений контракт у `client/src/vendor/shared` |

**Порядок, який не можна переставляти:** контракт (S1) → сервер (S2…S12) →
`vendor-shared` (S13) → клієнт (S14…S19). Клієнтський крок, що стартує до S13,
типізуватиметься проти застарілої копії контракту — і це не впаде, а тихо
розійдеться (`server/INSIGHTS.md`, «Codebase Patterns», про вендор двічі).

**Ротація S6 / S7 / S8 (після рев'ю плану) — читати перед прогоном A.**
Ролі трьох кроків змінилися; ідентифікатори лишились, щоб не ламати посилання.

| Крок | Було в першій редакції | Стало |
|---|---|---|
| S6 | вимірювальний скрипт | **складання повідомлень + модель-фейсінг схема** |
| S7 | бюджет над відрендереними блоками | **бюджет над зібраними повідомленнями** |
| S8 | промпт + схема | **вимірювальний скрипт** |

Причина в одному реченні: NFR-1 нормує «зібрані системне й користувацьке
повідомлення», тож рендер (S5), бюджет (S7) і вимір (S8) мають зійтися на
**одному** артефакті — фінальних повідомленнях, — інакше `test_brief_budget`
показує ≤8 000, поки реально надіслане перевищує бюджет.

Другий прогін отримує цей файл цілком і починає з S14; його *Verify* — команди
пакета `client/`, і жодна з них не чіпає `server/`.

### Requirements review

Знахідки перших проходів прийняті `spec-creator`-ом і застосовані: `c0eff32`
(AC-23 розщеплено на AC-61…AC-66, NFR-2 переписано на `result.attempts ≤ 2`,
додано AC-67) і `464e9da` (додано AC-68). Нижче — те, що лишилось.

| Знахідка | Вид | Цитата | Власник |
|---|---|---|---|
| ~~Ризик без жодного посилання проходив заземлення порожньо~~ — **закрито AC-68** (`464e9da`). AC-9 лишається про посилання поза allowlist, AC-68 — про їх відсутність; наслідок один, і рахуються вони в тому самому `N/M` | consistent | AC-68 `server/docs/specs/07-pr-brief.md`, секція «Заземлення», одразу після AC-9 | закрито — план несе це як поведінку (S10) |
| AC-24 робить перелік змінених файлів невідкидним і нічим не обмежує; на PR у 400 файлів самі шляхи ≈3 000 токенів, тож AC-26 досяжний незалежно від рівнів відкидання | bounded | `server/docs/specs/07-pr-brief.md:295-297`, зафіксовано як open question | `spec-creator` — свідомо лишено вимогою; план реалізує як записано |
| AC-61 спрацьовуватиме на кожній побудові в репо з одним реальним документом (`MAX_DOC_BYTES = 64_000` ≈ 16 000 токенів проти 8 000) — це щоденна поведінка, не аварійний клапан | bounded | `server/docs/specs/07-pr-brief.md`, блок під AC-61 | `spec-creator` — записано; план прив'язує S7 до тесту на **видимість** (AC-25), а не лише на факт відкидання |
| Ключ кешу — лише `head_sha`, тож зміна моделі або тексту промпту не інвалідує бриф на тому ж комміті | bounded | open question спеки про ключ кешу; AC-16 | `spec-creator` — план **не** додає інвалідації сам; рядок у *Open decisions* |
| `Status: draft` в обох файлах — критерії ще можуть рухатись | — | обидва файли, рядок 3 | `spec-creator` |
| Жоден AC не каже, що `GET` не будує бриф; це виводиться з AC-67 + клієнтського AC-53 | gap (дрібний) | AC-67 і `client/…:147-148` | план приймає як *Assumption 3*, вище |

### Recommendations

Усі прийняті власником до написання плану; лишаються тут як запис про те, чому
кроки мають саме таку форму.

- **R-1 (прийнято)** — ALTER наявної `pr_brief` до колонкової форми з `attempts`;
  `json` **не дропати**. Прецедент — `0015_intent_layer.sql`, який зробив рівно
  це з `pr_intent`, і чий заголовок пояснює, чому це безпечно лише на порожній
  таблиці. `pr_brief` порожня і не має викликачів: єдині згадки поза
  `db/schema/reviews.ts:181-186` — це `db/schema.ts:32,70`.
- **R-2 (прийнято)** — новий контракт поруч; мертвий `PrBrief{intent,blast,risks,history}`
  (`server/src/vendor/shared/contracts/brief.ts:170-177`) не переформовувати.
  `Risk` і `RiskSeverity` із того ж файлу (`:65-77`) перевикористовуються **як є**.
- **R-3 (прийнято)** — blast і текст issue тільки через композиційний корінь.
- **R-4 (прийнято)** — `?file=<path>` як `defaultOpen` на монтуванні `FileCard`.
- **R-5 (прийнято)** — два прогони `/impl` (див. *Execution*).

### Constraints in force

**Інваріанти, які ця зміна може зламати:**

- **Заземлення обов'язкове, і воно тут дзеркалить `groundFindings`.** Незаземлений
  елемент відкидається, а не пом'якшується; частка `N/M` пишеться **безумовно** —
  `reviewer-core/src/grounding.ts:52-83` (форма), `server/INSIGHTS.md` 2026-08-06
  (правило: гейт, що звітує лише коли спрацював, не відрізняється від гейта, що
  не запускався). AC-11 + NFR-5.
- **Захист від інжекції — один спільний гард, не сканування.** `INJECTION_GUARD` і
  `wrapUntrusted` **імпортуються** з рушія рівно так, як це робить
  `server/src/modules/intent/pipeline/prompt.ts:2,59`. Копія тексту компілюється
  й ламає інваріант. AC-35, AC-60, NFR-4.
- **Секрети не торкаються БД і git.** Модуль не читає `process.env`; GitHub і LLM
  приходять із контейнера (`container.github()`, `container.llm(...)`).
- **Міграції не крутяться на буті.** Після S2 — `cd server && pnpm db:migrate`,
  інакше `relation "pr_brief" ... column does not exist`.
- **`*.it.test.ts` = DB-backed** (testcontainers, потрібен Docker); решта
  герметична. Розбиття CI-набору ключується на імені файлу — і `gates.sh --unit`
  ці файли **виключає** (`gates.sh:8-17`), тож «увесь набір» вимагає окремої команди.
- **Тенантність.** `pr_brief`, як і `pr_intent`, **не має `workspace_id`**
  (`server/src/db/schema/reviews.ts:181-186`). Межа тенантності — це
  `container.reviewRepo.getPull(workspaceId, prId)` **першим викликом** кожного
  входу в модуль; `prId` із запиту, що дійшов до репозиторію без цього, — це
  крос-тенантне читання (дзеркало `IntentRepository`, `modules/intent/repository.ts:12-20`).

**`server/INSIGHTS.md` — записи, що зв'язують кроки:**

- **2026-08-06** — поріг, армований лише на фікстурах, «на трьох реальних PR
  спрацював нуль разів»; перевіряй передумову гейта на продакшн-даних, бо фікстура
  сама обирає собі вхід. → S8 існує саме тому, і S5 саме тому не ріже вхід.
- **2026-08-06** — раунд схема-репару реальний і дорогий: 2 attempts дали
  **8 378 out / $0.002714** проти забюджетованих ~$0.0003. → S9 задає межу явно.
- **2026-08-06** — гейт, що звітує лише коли спрацював, не відрізняється від
  гейта, що не запускався (`groundFindings` емітить `N/M` безумовно). → S10.
- **2026-08-06** (додатково, і це найдорожча пастка цього плану) — **`*.it.test.ts`,
  що пропустив ОДИН адаптерний override, робить живі оплачені виклики; єдиний
  симптом — таймаут**. Цей модуль резолвить і `container.github()` (текст issue),
  і `container.llm('openrouter')`. Ліки з того ж файлу (2026-08-06): інжектити
  **порожній `MockSecretsProvider`**, тоді `buildLlm` падає `ConfigError` замість
  того, щоб дійти до `server/.env`.
- **2026-08-06** — `buildApp` пише в БД, на яку вказує `DATABASE_URL`, ще до
  першого маршруту (`reapStaleRuns`): не ганяти набір проти стека з живими ранами.
- **2026-08-13** — `getBlastRadius` має дві гілки різної ціни, і викликач не
  бачить, яку отримав; `modules/blast/service.ts:assertPersistentPath` — це
  свідома копія умов фасаду. → бриф ходить через `container.blast`, ніколи через
  `container.repoIntel.getBlastRadius`.
- **2026-08-13** — кап, задокументований «per X» і застосований до плаского
  списку, — це інший ліміт під тією самою назвою (`capPerSymbol`). → AC-64
  («понад п'ять **на символ**») реалізується per-symbol, не `slice(0,5)`.
- **2026-08-08** — `getPrFiles` не має `ORDER BY`: «порядок файлів PR» не існує,
  сортувати явно в точці використання. → S4 сортує пофайлову статистику за
  `additions+deletions` DESC (щоб рівень AC-65 знав, які 50 — «найбільші»).
- **2026-08-06** — `pnpm db:generate` інтерактивний, **коли колонку дропають і
  додають на тій самій таблиці**. S2 нічого не дропає, тож має пройти без TTY;
  якщо drizzle-kit усе-таки питає — рецепт з `expect(1)` у тому ж записі.

**`client/INSIGHTS.md` — записи, що зв'язують кроки:**

- **2026-08-05** — тест, що передає проп руками, нічого не доводить про те, чи
  його хтось передає (значок скілів «зеленів» цілий лесон). → AC-36, AC-42,
  AC-52, AC-54, AC-55 перевіряються на рівні вкладки й сторінки, з **мокнутих
  даних API**.
- **2026-08-03** — один рантайм-імпорт Zod із `@devdigest/shared` коштує ~15 kB
  First Load JS на **кожному** маршруті. → контракти імпортуються `import type`.
- **2026-08-13** — `file:line`, зібраний на `head_sha`, «ідеально перевіряється
  руками на демо-PR і ламається на файлі, що зсунувся». → у `review_focus` немає
  рядка, і якорів рядків фіча не додає.
- **2026-08-10** — шосте `export *` у `lib/hooks/index.ts` — свіжа помилка ліну
  (`No new barrel files`). → `lib/hooks/brief.ts` імпортується напряму.
- **2026-08-08** — ані jsdom, ані наявна панель браузера не спостерігають
  прокрутку. → AC-43 сформульовано як **розгортання**, і тестується як розгортання.
- **2026-08-08** — картка з індексом 0 — хибнопозитивний доказ дип-лінка. → ціль
  тесту AC-43 має бути **не першою** карткою в списку.
- **2026-08-03/06** — `pnpm build` при запущеному `pnpm dev` вбиває dev-сервер
  (обидва пишуть у `client/.next`). → NFR-6 міряється при зупиненому dev.
- **2026-08-06** — шлях до `messages/` із тесту всередині
  `_components/<Name>/` — **вісім** рівнів угору. Копіювати специфікатор із
  сусіда, не рахувати.

**Frozen paths in range:**

- `client/src/vendor/shared/**` — **генерована копія**. Правити
  `server/src/vendor/shared`, потім `./scripts/vendor-shared.sh`, комітити обидві.
  Пряма правка втрачається на наступному запуску скрипта.
- `client/src/vendor/ui/**` — заморожено, джерела в репо немає. Фіча нічого тут
  не потребує: нового пункту навігації немає.
- Уже застосовані `server/src/db/migrations/*.sql` — не редагувати; S2 генерує
  **нову**. `pnpm db:generate` також переписує `migrations/meta/_journal.json` —
  комітити разом.

### Skill contract

| Крок | Файли | Skill (шлях + якір) | Правило, що зв'язує цей крок |
|---|---|---|---|
| S1 | `server/src/vendor/shared/contracts/review-api.ts` | `.claude/skills/zod/SKILL.md` — *Quick Reference* (§1 Schema Definition, §3 Type Inference) | фіксований набір рядків — це `z.enum`, а не `z.string()`; експортувати і схему, і `z.infer` тип під тим самим іменем — ручного дубля типу не існує |
| S2 | `server/src/db/schema/reviews.ts`, `server/src/db/migrations/00NN_*.sql` | `.claude/skills/postgresql-table-design/SKILL.md` — *Core Rules*; `.claude/skills/drizzle-orm-patterns/SKILL.md` — *Best Practices* | значення бізнес-набору тримає `text` + CHECK, а не PG-enum (дзеркало `pr_intent_confidence_ck`); міграція генерується, а не пишеться руками |
| S2 | `server/src/modules/brief/repository.ts` | `.claude/skills/onion-architecture/SKILL.md` §8 | ORM з'являється тільки тут; метод запису бере необов'язковий `tx` і резолвить `tx ?? this.db` — транзакцію відкриває сервіс, ніколи репозиторій |
| S3 | `server/src/platform/container.ts`, `server/src/modules/intent/service.ts` | `.claude/skills/onion-architecture/SKILL.md` §6, §11 | ніколи не імпортувати `service.ts`/`repository.ts` сусіднього модуля; спільна поведінка йде через композиційний корінь, який єдиний має право імпортувати всередину з будь-якого кільця |
| S4, S5 | `server/src/modules/brief/pipeline/sources.ts` | `.claude/skills/onion-architecture/SKILL.md` §7; `.claude/skills/security/SKILL.md` — *Agentic AI Security (OWASP 2026)* | сервіс координує, чиста обчислювальна логіка живе кільцем глибше; ASI09 — вміст, що прийшов ззовні, позначається як недовірений і валідується перед збереженням |
| S6 | `server/src/modules/brief/pipeline/prompt.ts`, `pipeline/schema.ts` | `.claude/skills/security/SKILL.md` — *Agentic AI Security (OWASP 2026)*; `.claude/skills/onion-architecture/SKILL.md` §11 | ASI01: кожен блок зовнішнього тексту йде в промпт обгорнутим і обмеженим; гард **імпортується** з рушія — копія тексту ламає інваріант «правило одне» |
| S7 | `server/src/modules/brief/pipeline/budget.ts` | `.claude/skills/onion-architecture/SKILL.md` §7 | правило, що є чистим обчисленням, лежить кільцем глибше й тестується без контейнера — жодного `container` всередині функцій бюджету |
| S8 | `server/src/tools/measure-brief-input.ts` | `.claude/skills/onion-architecture/SKILL.md` §9 | CLI — це теж транспорт: він викликає use-case і ніколи не тягнеться повз нього в репозиторій |
| S9, S10, S11 | `server/src/modules/brief/service.ts`, `pipeline/grounding.ts` | `.claude/skills/onion-architecture/SKILL.md` §7; `.claude/skills/security/SKILL.md` — *A09 — Logging and Alerting* | сервіс не знає про HTTP і не пише SQL; лог фіксує **композицію** — вид джерела, ref і розмір, — і жодного байта тіла PR, issue чи документа |
| S12 | `server/src/modules/brief/routes.ts`, `server/src/modules/index.ts` | `.claude/skills/fastify-best-practices/SKILL.md` — *Core Principles*; `.claude/skills/onion-architecture/SKILL.md` §9 | схема оголошується на маршруті (`params` і `response`), ніколи `Schema.parse` у тілі хендлера; хендлер робить рівно три речі — розібрати, делегувати, змапити код статусу |
| S13 | `server/test/brief-*.test.ts`, `server/test/brief.it.test.ts` | `.claude/skills/onion-architecture/SKILL.md` §12 | тест кільця 2 бере override-двійники й **не** бере базу; DB-залежні файли названі окремо, щоб швидка смуга виключала їх за іменем; асертити записаний вихід, а не кількість викликів |
| S14 | `client/src/lib/hooks/brief.ts` | `.claude/skills/frontend-architecture/SKILL.md` §10, §12 | ключ запиту лишається приватним для модуля, назовні йде хук і названий інвалідатор; нових барелів не додавати — імпорт прямий |
| S15 | `client/src/app/repos/[repoId]/pulls/[number]/_components/PrBriefCard/**` | `.claude/skills/frontend-architecture/SKILL.md` §4; `.claude/skills/react-best-practices/SKILL.md` — *Derive, Don't Store (CRITICAL)*, *Accessibility (HIGH)* | папка компонента = сам компонент + його тест обов'язково, решта файлів на вимогу; те, що виводиться з пропсів, рахується в рендері, ніколи не лежить у `useState`; іконкова кнопка без `aria-label` невидима для читача екрана |
| S16 | `client/src/app/…/_components/OverviewTab/OverviewTab.tsx` | `.claude/skills/next-best-practices/SKILL.md` — *Bundling*; `.claude/skills/frontend-architecture/SKILL.md` §10 | контракти імпортуються лише як типи (рантайм-імпорт тягне `zod` у спільний чанк); хуки живуть на вкладці, картка лишається презентаційною |
| S17 | `client/src/components/diff-viewer/FileCard/FileCard.tsx`, `…/_components/SmartDiffViewer/*`, `…/DiffTab/*`, `…/PrDetailView/*` | `.claude/skills/frontend-architecture/SKILL.md` §1; `.claude/skills/react-best-practices/SKILL.md` — *Derive, Don't Store (CRITICAL)* | компонент, яким користується більш ніж один рівень маршруту, лишається в `components/`; «яка картка розгорнута» виводиться зі стану URL на монтуванні, а не синхронізується ефектом |
| S18, S19 | `client/**/*.test.tsx` | `.claude/skills/react-testing-library/SKILL.md` — *Query Priority* | шукати `getByRole` першим, `getByText` для статичного тексту; `getByTestId` — останній засіб. (У цьому репо мережа мокається через `vi.mock` хуків/`fetch`, а не MSW — так вимагає *Traceability* клієнтської спеки.) |

### Steps

> **Примітка про ротацію (після крос-модельного рев'ю).** S6 тепер складає
> повідомлення, S7 бюджетує **їх**, S8 їх міряє. Ідентифікатори лишились на
> місці, ролі — ні. Прогін, що піде за першою редакцією, збудує бюджет над
> проміжними блоками й пройде тест, лишивши поведінку зламаною.

#### Прогін A — сервер

**S1 — контракт брифа поруч із мертвим `PrBrief`**
- Файли: `server/src/vendor/shared/contracts/review-api.ts` (змінено) ·
  `client/src/vendor/shared/contracts/review-api.ts` (**згенеровано** скриптом)
- Skills: `.claude/skills/zod/SKILL.md` — *Quick Reference*
- Що додається (імена фіксовані, далі на них посилається весь план):
  - `ReviewFocusItem = z.object({ path: z.string(), reason: z.string() })` —
    **без** поля рядка (AC-13);
  - `BriefRiskLevel` — перевикористати `RiskSeverity` з `./brief.js` (`brief.ts:65-66`);
  - `PrBriefRecord = z.object({ pr_id, what, why, risk_level, risks: z.array(Risk),
    review_focus: z.array(ReviewFocusItem), risks_grounded: z.boolean(),
    dropped_blocks: z.array(z.string()), unavailable_inputs: z.array(z.string()),
    head_sha, provider, model, derived_at,
    tokens_in: z.number().int().nullable(), tokens_out: …nullable(),
    cost_usd: z.number().nullable(), attempts: z.number().int() })`;
  - `PrBriefView = z.object({ brief: PrBriefRecord.nullable(), stale: z.boolean(),
    reused: z.boolean(), model_calls: z.number().int() })`.
  - `Risk` імпортується з `./brief.js`, як `PrIntentRecord` уже імпортує `Intent`.
- **`Risk.file_refs` лишається `z.array(z.string())` без `.min(1)`.** Спека
  фіксує цю властивість контракту наслідком, а не змінює її: порожній масив
  легальний **на вході**, і саме тому існує AC-68, який відкидає такий ризик на
  заземленні (S10). Ставити `.min(1)` у контракт означало б відсунути це на рівень
  парсингу відповіді моделі, де воно перетворилося б на раунд схема-репару, — а
  NFR-2 обмежує їх до двох.
- **`unavailable_inputs` — це дім для AC-59.** Без нього «перелічити недоступний
  issue серед недоступних входів» не має куди подітися: збирач його рахує, а
  відповідь і рядок БД його гублять. Дзеркало `pr_intent.missing_context`
  (`server/src/db/schema/reviews.ts:160`).
- Коментар над блоком обов'язковий і має назвати розкол із `PrBrief` у `brief.ts`
  — той самий прийом, який файл уже застосував для `BlastResponse`
  (`review-api.ts:152-159`).
- `cost_usd` nullable **без** `.default(0)`: `null` = невідомо, `0` = безкоштовно
  (AC-21, і це інваріант репо — `db/schema/reviews.ts:169-170`).
- Done when: `./scripts/vendor-shared.sh` повідомляє про перевендорення, обидві
  копії однакові, обидва пакети типізуються.
- Verify: `./scripts/vendor-shared.sh --check && (cd server && pnpm typecheck)`
- Risk: рантайм-імпорт цих схем на клієнті — +15 kB на кожному маршруті; тут
  нічого не змінюється, бо клієнт бере їх `import type` (S15).

**S2 — сховище: ALTER `pr_brief` + репозиторій**
- Файли: `server/src/db/schema/reviews.ts` (змінено, `prBrief` на `:181-186`) ·
  `server/src/db/migrations/00NN_*.sql` (нове, згенеровано) ·
  `server/src/db/migrations/meta/_journal.json` (перезаписано генератором) ·
  `server/src/modules/brief/repository.ts` (нове)
- Skills: `.claude/skills/postgresql-table-design/SKILL.md` — *Core Rules* ·
  `.claude/skills/drizzle-orm-patterns/SKILL.md` — *Best Practices* ·
  `.claude/skills/onion-architecture/SKILL.md` §8
- Колонки, що додаються до `pr_brief` (форма — дзеркало `pr_intent`,
  `reviews.ts:123-171`): `what text NOT NULL`, `why text NOT NULL`,
  `risk_level text NOT NULL` + CHECK `pr_brief_risk_level_ck in ('high','medium','low')`,
  `risks jsonb NOT NULL DEFAULT '[]'`, `review_focus jsonb NOT NULL DEFAULT '[]'`,
  `dropped_blocks jsonb NOT NULL DEFAULT '[]'`,
  **`unavailable_inputs jsonb NOT NULL DEFAULT '[]'`** (AC-59),
  `risks_grounded boolean NOT NULL DEFAULT true`, `head_sha text NOT NULL`,
  `provider text NOT NULL`, `model text NOT NULL`,
  `derived_at timestamptz NOT NULL DEFAULT now()`, `tokens_in integer`,
  `tokens_out integer`, `cost_usd double precision`,
  `attempts integer NOT NULL DEFAULT 1`.
- **`json` не дропати.** Дати їй `DEFAULT '{}'::jsonb`, інакше вставка без цієї
  колонки впаде на `NOT NULL`. У коментарі схеми написати, що це слот стартера,
  який лишається розширювальною точкою (кореневий `CLAUDE.md`: порожні таблиці й
  невикористані слоти — не мертвий код).
- Заголовок міграції — копія логіки `0015_intent_layer.sql:1-10`: перелічити, що
  саме безпечне лише на порожній таблиці, і назвати перевірку
  (`select count(*) from pr_brief` = 0).
- Репозиторій: `get(prId)` і `upsert(values, tx?)` з `onConflictDoUpdate` по
  `prId`, що перезаписує **кожну** provenance-колонку, `derived_at` включно —
  дослівний прецедент `modules/intent/repository.ts:56-96` (AC-14).
- Done when: `pnpm db:generate` створив рівно один `.sql`, `pnpm db:migrate`
  пройшов на чистій БД, `pnpm typecheck` зелений.
- Verify: `cd server && pnpm db:generate && pnpm db:migrate && pnpm typecheck`
- Risk: якщо drizzle-kit усе-таки спитає «created or renamed?» — це означає, що
  щось таки дропається; зупинитись і перечитати діф схеми, а не відповідати
  навмання (`server/INSIGHTS.md`, 2026-08-06: відповідь «create» замість «rename»
  була б тихо неправильною).

**S3 — композиційний корінь: `container.blast` і текст issue**
- Файли: `server/src/platform/container.ts` (змінено) ·
  `server/src/modules/intent/service.ts` (змінено, додати метод) ·
  `server/src/modules/intent/constants.ts` (без змін — перевикористати
  `MAX_ISSUE_BODY_CHARS`, `:35`)
- Skills: `.claude/skills/onion-architecture/SKILL.md` §6, §11
- `get blast(): BlastService` — точна форма `get intent()` (`container.ts:185-187`),
  з коментарем, який називає причину: бриф — сусід `modules/blast`, і §11 робить
  сусідній модуль приватним.
- `IntentService.linkedIssueText(record, repo): Promise<{ ref, text } | { ref, note } | null>`
  — новий **публічний метод сервісу**, поруч із `renderIntentBlock` і
  `scopeFilterArmed`, які існують рівно з цієї причини (`service.ts:150-165`).
  Реалізація: знайти в `record.sources` запис `{kind:'linked_issue', status:'used'}`,
  взяти номер із `ref` (`#N`), викликати `(await container.github()).getIssue(...)`,
  склеїти `title` + `body.slice(0, MAX_ISSUE_BODY_CHARS)` — дослівно як
  `intent/pipeline/sources.ts:278-300`, з тим самим `try/catch`, що повертає
  `note` замість тексту (AC-34, AC-59). `null` — коли `used`-джерела немає.
- Done when: `modules/brief` ще не існує, але `container.blast` і новий метод
  типізуються й лінтуються; жодного імпорту з сусіднього модуля не додано.
- Verify: `cd server && pnpm typecheck && pnpm lint`
- Risk: `pnpm lint` тримає onion-кільця (шість винятків забейслайнено) — новий
  імпорт із сусіднього модуля впаде саме тут, і це бейслайн, що працює як
  задумано, а не привід його розширювати.

**S4 — збирач входу: детерміновані джерела, use-case-вхід**
- Файли: `server/src/modules/brief/constants.ts` (нове) ·
  `server/src/modules/brief/pipeline/sources.ts` (нове)
- Skills: `.claude/skills/onion-architecture/SKILL.md` §7 ·
  `.claude/skills/security/SKILL.md` — *Agentic AI Security (OWASP 2026)*
- Точка входу — **use-case-функція** `collectBriefInput(container, workspaceId, prId)`,
  а не метод сервісу. Так її можуть викликати і `BriefService` (S11), і
  вимірювальний CLI (S8), не чекаючи один на одного і не тягнучись повз сервіс у
  репозиторій (onion §9). Перший її виклик — `reviewRepo.getPull(workspaceId, prId)`:
  це межа тенантності.
- Збирає шість джерел (AC-1) у типізований `CollectedInput` із **іменованими
  блоками** (`pr-title`, `intent`, `blast-symbols`, `blast-endpoints`,
  `blast-crons`, `diff-stats`, `file-stats`, `context-docs`, `linked-issue`) —
  імена блоків потім є одиницею відкидання (S7) і рядками у `dropped_blocks` (AC-25):
  1. рядок intent — через `container.intent` (S11 вирішує, деривувати чи ні);
  2. відповідь blast — **через `container.blast.get(...)`**, ніколи через
     `container.repoIntel.getBlastRadius` (`server/INSIGHTS.md`, 2026-08-13);
  3. PR-рівнева статистика — `additions`/`deletions`/`files_count` із рядка пулла;
  4. пофайлова — `path`/`additions`/`deletions` із `pr_files`, **явно відсортовані**
     за `additions+deletions` DESC (порядку файлів PR не існує:
     `server/INSIGHTS.md`, 2026-08-08). Сортування тут — **не** кап: воно лише
     робить визначеним, які 50 є «найбільшими», коли рівень AC-65 спрацює;
  5. документи project context — `container.contextRepo.listDocs(workspaceId, repoId)`,
     **усі**, впорядковані за іменем (AC-32);
  6. текст issue — `container.intent.linkedIssueText(...)` (AC-33, AC-34, AC-59).
- **Назва PR — окремий іменований блок `pr-title`, а не частина шапки повідомлення.**
  Вона невідкидна (AC-24), але недовірена — її пише автор PR, — і NFR-4 покриває
  її прямо. Блоком вона стає саме для того, щоб перелік блоків, який перелічує
  `test_brief_prompt_guard`, її **бачив**: текст, вкладений у шапку, такого
  перегляду не проходить, і незагорнута назва пройшла б повз зелений тест.
- **`patch` не читається взагалі.** Тип `CollectedInput` не має поля, куди його
  можна було б покласти — це AC-2, реалізований структурно, а не дисципліною.
- Недоступні входи накопичуються в `unavailable_inputs: string[]`, доживають до
  відповіді й до рядка БД (AC-59; колонка — у S2, поле контракту — у S1).
- Done when: `test_brief_input` і `test_brief_no_patch` зелені на підставлених
  джерелах; у фікстурі `pr_files[].patch` заповнений, у зібраному вході його немає.
- Verify: `cd server && pnpm exec vitest run test/brief-sources.test.ts`
- Risk: `BlastService.get` на неіндексованому репо повертає `degraded` — це не
  помилка збирача, а вхід для AC-8; не перетворювати на throw.

**S5 — рендер блоків: повний обсяг, БЕЗ преміряльних капів**
- Файли: `server/src/modules/brief/pipeline/sources.ts` (доповнено)
- Skills: ті самі, що в S4
- Кожен блок рендериться у текст детерміновано (двічі поспіль — той самий текст),
  зі стабільним іменем.
- **Жодних капів на цьому кроці.** Ані «п'ять викликачів на символ», ані «50
  найбільших файлів» тут не застосовуються. Обидва — це **рівні відкидання**
  AC-64 і AC-65; застосувати їх під час рендеру означає, що в проді вони не
  спрацюють ніколи, ніколи не потраплять у `dropped`, а юніт-тест із неурізаним
  входом усе одно зеленітиме — тихе усічення, яке NFR-8 забороняє прямо. Це той
  самий клас дефекту, що й «гейт, армований лише на фікстурах»
  (`server/INSIGHTS.md`, 2026-08-06).
- Єдині капи, що діють до бюджету, — **чужі**: `MAX_SYMBOLS = 50`
  (`server/src/modules/blast/constants.ts`) і `MAX_CALLERS_PER_SYMBOL = 20`
  (`server/src/modules/repo-intel/constants.ts:19`) належать blast і приходять уже
  застосованими в його відповіді. Модуль брифа їх не дублює й не посилює.
- Done when: рендер детермінований; на вході з 300 файлами й 40 символами рендер
  містить **усі** з них.
- Verify: `cd server && pnpm exec vitest run test/brief-sources.test.ts`
- Risk: недетермінований порядок (Map/Set-ітерація) робить кеш і тести
  мерехтливими; сортувати явно всюди, де порядок видно.

**S6 — складання повідомлень і модель-фейсінг схема** *(був S8 — крок переїхав, див. примітку про ротацію вище)*
- Файли: `server/src/modules/brief/pipeline/prompt.ts` (нове) ·
  `server/src/modules/brief/pipeline/schema.ts` (нове)
- Skills: `.claude/skills/security/SKILL.md` — *Agentic AI Security (OWASP 2026)* ·
  `.claude/skills/onion-architecture/SKILL.md` §11
- Експортує **чисту** `assembleBriefMessages(input: CollectedInput): ChatMessage[]`
  — саме той артефакт, що поїде провайдеру: системне повідомлення, гард, обгортки,
  підписи блоків, обрамлення. Чиста й без I/O рівно тому, що S7 викликатиме її
  повторно після кожного рівня відкидання, а S8 — міряти її вихід.
- `import { INJECTION_GUARD, wrapUntrusted } from '@devdigest/reviewer-core'` —
  дослівно як `intent/pipeline/prompt.ts:2`; системне повідомлення **закінчується**
  `${INJECTION_GUARD}` (AC-60, і саме «останній» перевіряє тест).
- **Кожен** блок недовіреного входу йде через `wrapUntrusted(label, text)` —
  включно з `pr-title` (AC-35, NFR-4). **Дві нові недовірені поверхні**, яких
  раніше в промптах не було: шляхи з індексу репозиторію та маршрути endpoints —
  обидві всередині обгорток.
- Інструкція «кожен ризик має назвати щонайменше одне посилання на файл або
  endpoint із входу» в системному повідомленні **лишається**, але тепер вона —
  оптимізація, а не доказ: після AC-68 ризик без посилання відкидається кодом у
  S10 незалежно від того, що написано в промпті. Її роль — зменшити кількість
  відкидань, тобто зберегти корисний вихід; **жоден тест на неї не спирається**, і
  жодне AC нею не покривається.
- `BriefExtraction` (schema.ts) — модель-фейсінг і **навмисно вужча** за контракт:
  `{ what, why, risk_level, risks[], review_focus[] }` і нічого більше (AC-6).
  Ані `dropped_blocks`, ані `unavailable_inputs`, ані `attempts`, ані провенансу —
  сервер знає це сам, і схема не дає моделі місця, куди їх вигадати (прийом
  `intent/pipeline/schema.ts:9-19`). `review_focus[]` — `{path, reason}`, поля
  рядка не існує (AC-13).
- **Без `.max()` і без `.min()` у самій схемі** — стеля застосовується після парсу
  зрізом, а порожній `file_refs` ловить AC-68 на заземленні
  (`intent/pipeline/schema.ts:21-31` фіксує, у що обійшлася стеля в схемі: модель,
  що на одиницю перевищила ліміт, після ре-промпту стала різко біднішою при
  подвоєних вихідних токенах — а тут це коштувало б ще й раунду з NFR-2).
- Done when: `test_brief_prompt_guard` зелений і **перелічує секції**, а не
  вибирає з них: нуль недовірених секцій поза обгорткою, `pr-title` включно; гард
  — останній у системному повідомленні.
- Verify: `cd server && pnpm exec vitest run test/brief-prompt.test.ts`
- Risk: скопіювати текст гарда замість імпорту. Компілюється, тести проходять,
  інваріант зламано.

**S7 — токен-бюджет над ЗІБРАНИМИ ПОВІДОМЛЕННЯМИ і рівні відкидання**
- Файли: `server/src/modules/brief/pipeline/budget.ts` (нове) ·
  `server/src/modules/brief/constants.ts` (доповнено)
- Skills: `.claude/skills/onion-architecture/SKILL.md` §7
- Сигнатура — `fitToBudget(input, assemble, tokenizer, budget): { messages, input, dropped: string[] }`,
  де `assemble` — це `assembleBriefMessages` із S6. Функція чиста, без контейнера,
  тому тестується без бази.
- **Міряється те, що поїде**, а не проміжні блоки: після кожного рівня відкидання
  вхід перезбирається, і вимір — це
  `messages.reduce((n, m) => n + tokenizer.count(m.content), 0)`. NFR-1 називає
  одиницю прямо — «зібраних системного й користувацького повідомлень», — а
  системний промпт, гард, обгортки й підписи блоків важать стільки ж токенів,
  скільки вміст. Вимір над самими лише блоками показував би ≤8 000, поки реально
  надіслане перевищує бюджет.
- Вимір **до** відправлення, лічильником, не `length/4` (AC-22, NFR-1).
- Рівні застосовуються по одному й **тільки доки поточний не вичерпано** (AC-23):
  1. документи project context — цілими файлами, з кінця за іменем (AC-61);
  2. cron-записи (AC-62); 3. endpoints (AC-63);
  4. викликачі понад п'ять **на символ** — per-symbol, не `slice(0,5)` по плоскому
     списку (`capPerSymbol`, `server/INSIGHTS.md` 2026-08-13) (AC-64);
  5. пофайлова статистика понад 50 найбільших (AC-65);
  6. текст пов'язаного issue (AC-66).
- Невідкидне за жодних умов: назва PR, резюме intent зі списками scope, перелік
  змінених файлів (AC-24).
- Кожне **застосоване** відкидання додає ім'я блоку в `dropped` (AC-25, NFR-8) — і
  саме тому рівні 4 і 5 не можна робити капами рендеру: те, що зрізав рендер, у
  `dropped` не потрапляє й користувачеві не видно.
- Після всіх рівнів вхід усе ще понад бюджет → кинути доменну помилку (AC-26).
  **Тут доводиться лише сам throw**: `fitToBudget` не має ані контейнера, ані
  доступу до `llm()`, тож стаб, що кидає, нічого б тут не довів. Друга половина
  AC-26 — «запит моделі не відправлено» — доводиться на межі сервісу в S9.
- Done when: `test_brief_budget`, `test_brief_budget_order`,
  `test_brief_budget_levels` зелені; `test_brief_budget_order` перевіряє випадок
  «рівень 3 спрацював, а рівень 2 мав ще матеріал».
- Verify: `cd server && pnpm exec vitest run test/brief-budget.test.ts`
- Risk: реалізація, що застосовує рівні одним прогоном по списку, провалить
  `test_brief_budget_order` — і це задум.

**S8 — ВИМІР: авторизувати 8 000 реальними даними** *(був S6 — крок переїхав: міряти можна лише те, що вже збирається (S4–S5) і складається (S6))*
- Файли: `server/src/tools/measure-brief-input.ts` (нове) ·
  `server/package.json` (додати скрипт `"measure:brief": "tsx src/tools/measure-brief-input.ts"`)
- Skills: `.claude/skills/onion-architecture/SKILL.md` §9
- Скрипт бере `--pr <uuid>` (можна кілька), викликає `collectBriefInput` (S4) →
  `assembleBriefMessages` (S6) і друкує **поблочно**: ім'я блоку, символи, токени
  `container.tokenizer.count()` — і **підсумок по зібраних повідомленнях**, тобто
  рівно ту величину, яку нормує NFR-1. Жодного модельного виклику; іншого режиму в
  скрипта немає.
- Друкує також, які рівні відкидання спрацювали б на цьому вході (виклик
  `fitToBudget` із S7) — це і є перевірка, що рівні 4 і 5 досяжні на реальних
  даних, а не мертві.
- Запуск потребує піднятої БД із реальними імпортованими PR:
  `./scripts/dev.sh --db-only`, потім `cd server && pnpm db:migrate`, потім
  `pnpm measure:brief --pr <uuid> --pr <uuid> --pr <uuid>`.
- **Умова зупинки, а не усна домовленість.** Нехай `M` — медіана трьох підсумків
  по зібраних повідомленнях:
  - `4 000 ≤ M ≤ 16 000` → константа лишається `BRIEF_TOKEN_BUDGET = 8_000`, а три
    виміряні числа записуються коментарем над нею («виміряно на PR …, дата»).
  - `M < 4 000` або `M > 16 000` → **крок зупиняється**. Число не правиться в коді:
    NFR-1 належить спеці, і зміна порогу — це зміна вимоги. Повернути вимір
    `spec-creator` і не йти далі.
  - Виміряти неможливо (немає імпортованих PR / немає Docker) → **не вигадувати
    число**: залишити 8 000, записати в коментар «не виміряно, причина», і
    доповісти це в *Implementation Report* як незакритий пункт.
- Done when: скрипт відпрацював на трьох PR і надрукував поблочні числа плюс
  підсумок, або задокументовано, чому не зміг.
- Verify: `cd server && pnpm measure:brief --pr <uuid>` (вивід — сам артефакт)
- Risk: спокуса виміряти на фікстурах. Фікстура сама обирає собі вхід і ніколи не
  містить 64-кілобайтного документа project context — це рівно та помилка, що
  описана в `server/INSIGHTS.md` (2026-08-06).

**S9 — один структурований виклик: вартість, спроби, явна межа репару**
- Файли: `server/src/modules/brief/service.ts` (нове, перша половина) ·
  `server/src/modules/brief/constants.ts` (доповнено)
- Skills: `.claude/skills/onion-architecture/SKILL.md` §7 ·
  `.claude/skills/security/SKILL.md` — *A09 — Logging and Alerting*
- Рівно один `container.llm(provider).completeStructured({...})` (AC-6), із
  **`maxRetries: 1`, заданим явно** — дефолт `req.maxRetries ?? 2` дає до трьох
  запитів (`reviewer-core/src/llm/openrouter.ts:61,68`), і саме тому AC-27
  вважається виконаним лише за явно заданої межі. `attempts` із результату
  зберігається (AC-28) і потрапляє в лог окремим рядком, коли `> 1` (NFR-2).
- **Друга половина AC-26 доводиться тут**: `fitToBudget` кинув → сервіс виходить
  **до** `container.llm(...)`. Тест — `test_brief_budget` у
  `server/test/brief-service.test.ts`: контейнер зібрано з override-двійниками
  (onion §12 — це юніт, бази не треба), а стаб `llm()` **кидає** при виклику, тож
  зелений тест доводить відсутність виклику, а не його дешевизну (прецедент
  `06-project-context.md`, NFR-4).
- Модель резолвиться так само, як в `intent`: спершу `container.featureModel(...)`,
  далі власний дефолт модуля (`intent/service.ts:325-333`); лог називає **роль**
  виклику, не лише слаг.
- `cost_usd`: `null` = невідомо, ніколи не `0` (AC-21).
- Лог фіксує композицію — вид джерела, ref, розмір — і **жодного байта** тіл
  (форма `intent/service.ts:203-235`, включно з `redactUrlForLog`).
- Done when: `test_brief_call`, `test_brief_cost`, `test_brief_budget` (серверна
  половина) зелені: рівно один виклик, форма відповіді, другий раунд є / третього
  немає, `attempts ≤ 2`, невідома вартість не сплющена в нуль, понадбюджетний вхід
  не дійшов до провайдера.
- Verify: `cd server && pnpm exec vitest run test/brief-service.test.ts`
- Risk: транспортні ретраї HTTP-клієнта (`openrouter.ts:55`) лежать **нижче**
  рівня схеми — фіча їх не бачить і не обмежує; NFR-2 навмисно не в тих одиницях,
  і тест не повинен намагатися їх рахувати.

**S10 — заземлення**
- Файли: `server/src/modules/brief/pipeline/grounding.ts` (нове) ·
  `server/src/modules/brief/service.ts` (доповнено)
- Skills: `.claude/skills/onion-architecture/SKILL.md` §7 ·
  `.claude/skills/security/SKILL.md` — *A09 — Logging and Alerting*
- Будуються **два** списки з однієї відповіді blast, і це не надмірність:
  - `allowlist` (AC-7) — `changed_files` + шляхи символів + шляхи викликачів +
    **маршрути endpoints**; проти нього перевіряються посилання **ризиків** (AC-9);
  - `filePaths` — той самий список **без маршрутів endpoints**; проти нього
    перевіряються `review_focus[].path` (AC-10).
  Причина конкретна: обидва — рядки в одному наборі, тож `review_focus.path`, що
  дорівнює реальному маршруту (`GET /repos/:id`), інакше пройшов би перевірку — і
  клієнт отримав би елемент, якому нема чого відкривати (клієнтський AC-42).
  Перевірка проти підмножини **строгіша** за AC-10 і задовольняє його дослівно;
  рядок про це є в *Open decisions*.
- На `status === 'degraded'` обидва списки будуються зі шляхів `pr_files` (AC-8).
- **Ризик відкидається за двома різними причинами й одним шляхом:**
  - `file_refs` порожній — ризик не називає жодного посилання (**AC-68**);
  - хоча б одне посилання є, але поза `allowlist` (**AC-9**).
  Це два різні предикати й два різні випадки в тесті; наслідок один — ризик не
  доживає до відповіді.
- Елемент `review_focus` поза `filePaths` відкидається (AC-10). Усе це дзеркало
  `groundFindings` (`reviewer-core/src/grounding.ts:52-83`): перевіряється
  належність до списку, а не збіг тексту.
- **Один лічильник, і це рішення спеки, а не спрощення.** Ризик, відкинутий за
  AC-68, входить у `M` і не входить у `N` того самого `N/M` з AC-11 — так само, як
  відкинутий за AC-9. Другого лічильника **немає**: `N/M` існує, щоб відрізняти
  «модель не знайшла ризиків» (`M = 0`) від «ми викинули все, що вона знайшла»
  (`M = 5, N = 0`), і окрема метрика зробила б це заголовне число неоднозначним
  рівно там, де воно єдине щось означає.
- **Причина відкидання живе в журналі, не в метриці.** Рядок `N/M` пишеться
  **безумовно** — і коли відкинуто, і коли ні (AC-11, NFR-5; правило з
  `server/INSIGHTS.md`, 2026-08-06), а поруч із ним кожен відкинутий елемент
  отримує свою причину в тих самих словах, що й предикати вище: `no refs`
  (AC-68) проти `ref outside allowlist: <ref>` (AC-9) — рівно як `groundFindings`
  повертає `dropped[].reason` (`grounding.ts:61,74-77`). Агрегат лишається
  порівнюваним між побудовами; розрізнення причини лишається читабельним.
- Якщо відкинуто **всі** ризики: `risk_level` від моделі зберігається (AC-12), а
  `risks_grounded: false` їде у відповіді й у рядку БД (AC-58) — незалежно від
  того, яка з двох причин спрацювала.
- **Заземлення — не захист від інжекції.** Зловмисно названий файл, що є в
  allowlist, цю перевірку пройде; захист — гард із S6.
- Done when: `test_brief_grounding` зелений по всіх підпунктах, окремими
  випадками: ризик із `file_refs: []` відкинуто (AC-68); ризик із посиланням поза
  allowlist відкинуто (AC-9); обидва пораховані в тому самому `M`; кожен має свою
  причину в лозі; `review_focus.path`, що дорівнює маршруту endpoint, відкинуто.
  **Спека прив'язує AC-68 до `test_brief_grounding`** — того самого імені, що несе
  AC-9 і AC-10, — а її прозовий рядок «дві різні причини, два різні тести» читаю
  як два різні **випадки** в цьому файлі: окремий файл розірвав би спільне
  твердження про `M`, яке тільки й доводиться на них разом.
- Verify: `cd server && pnpm exec vitest run test/brief-service.test.ts`
- Risk: порахувати `N/M` після зрізу — і тоді усічений список звітує власну
  довжину (та сама помилка, що вже сталася з `BlastResponse.counts`).

**S11 — кеш на стан PR, регенерація, ізоляція відмови**
- Файли: `server/src/modules/brief/service.ts` (доповнено) ·
  `server/src/modules/brief/helpers.ts` (нове — `toBriefDto`)
- Skills: `.claude/skills/onion-architecture/SKILL.md` §7, §8
- `view(workspaceId, prId)`: `requirePull` **першим викликом** (тенантність), далі
  читання рядка. Збіг `head_sha` → віддати збережене, `reused: true`,
  `model_calls: 0`, **без виклику моделі** (AC-16, AC-20, NFR-3). Розбіжність →
  віддати збережене з `stale: true` (AC-17). Рядка немає → `{ brief: null }`,
  200, не помилка (AC-67).
- `build(workspaceId, prId)`: intent через `container.intent.deriveIfStale(...)`
  — свіжий перевикористовується без виклику (AC-4), застарілий/відсутній
  деривується першим (AC-3), і `model_calls` рахує обидва (AC-5, NFR-3).
  Регенерація перебудовує навіть на незмінному `head_sha` (AC-18) — безумовний
  шлях, дзеркало `IntentService.derive` (`service.ts:113-130`).
- **Одночасні побудови склеюються.** `build` тримає `Map<prId, Promise<…>>`
  in-flight-побудов: другий POST, що прийшов, поки перший не завершився, чекає на
  той самий проміс замість того, щоб зробити другий **оплачений** виклик і
  перегнати upsert, у якому старіша побудова може перезаписати свіжішу. AC-18
  цього не порушує: він вимагає перебудови на незмінному head, а не окремого
  виклику на кожен HTTP-запит. Rate limit (AC-19) — інша межа й не замінює цю:
  10/хв усе одно дозволяє десять паралельних.
- Один рядок на PR, upsert (AC-14) з усіма provenance-полями (AC-15, AC-28,
  `unavailable_inputs` включно — AC-59).
- Виклик впав → **не чіпати** збережений рядок; помилка йде вгору (AC-29).
- Вхід не залежить від рев'ю-рану: `findings`, `verdict`, `score` не читаються
  ніде в модулі — структурно, а не за домовленістю (AC-30, AC-31).
- Done when: `test_brief_cache_it`, `test_brief_intent_it`, `test_brief_input_it`,
  `test_brief_failure_it`, `test_brief_no_runs_it` зелені.
- Verify: `cd server && pnpm exec vitest run test/brief.it.test.ts`
- Risk: **найдорожчий у плані.** `*.it.test.ts`, що не заінжектив `github` або
  `llm`, робить живі оплачені виклики, і єдиний симптом — таймаут. Інжектити
  порожній `MockSecretsProvider` (`server/INSIGHTS.md`, 2026-08-06) — тоді
  забутий порт стає гучним `ConfigError`, а не мережею.

**S12 — маршрути**
- Файли: `server/src/modules/brief/routes.ts` (нове) ·
  `server/src/modules/index.ts` (додати один імпорт + один запис)
- Skills: `.claude/skills/fastify-best-practices/SKILL.md` — *Core Principles* ·
  `.claude/skills/onion-architecture/SKILL.md` §9
- `GET /pulls/:id/brief` — `{ params: IdParams, response: { 200: PrBriefView } }`,
  без rate limit (нічого не витрачає, як `blast` і `smart-diff`).
- `POST /pulls/:id/brief` — та сама схема плюс
  `config: { rateLimit: { max: 10, timeWindow: '1 minute' } }` (AC-19), дослівно
  як `intent/routes.ts:36-50`, з тим самим коментарем про причину.
- Хендлер: `getContext` → сервіс → повернути. Ніяких `Schema.parse` у тілі,
  ніякої бізнес-логіки.
- Done when: `test_brief_routes_it` зелений: 11-й запит за хвилину відхилено, PR
  без брифа віддає порожній бриф, а не 404/500; невалідний uuid — 422 до хендлера.
- Verify: `cd server && pnpm exec vitest run test/brief.it.test.ts test/routes-smoke.test.ts`
- Risk: `buildApp` пише в БД, на яку вказує `DATABASE_URL`, ще до першого
  маршруту — не ганяти набір проти стека з живими ранами.

**S13 — межа прогонів: перевірка серверної половини й вендор контрактів**
- Файли: жодного нового
- Done when: **увесь** серверний набір зелений — юніт-смуга **і** DB-залежна, —
  вендоровані копії ідентичні, лінт і типи чисті.
- Verify, три команди, і третя не є необов'язковою:
  1. `./scripts/vendor-shared.sh && ./scripts/vendor-shared.sh --check`
  2. `bash .claude/skills/pr-self-review/scripts/gates.sh --unit --only server`
  3. `cd server && pnpm exec vitest run` — **без фільтра**. `gates.sh --unit`
     виключає всі `*.it.test.ts` за іменем файлу (`gates.sh:8-17`), тож сама лише
     команда 2 лишає весь інтеграційний шар цієї фічі неперевіреним. Еквівалент —
     `gates.sh --full --only server`, якщо Docker уже піднятий.
- Risk: якщо `--check` червоний, клієнтський прогін почне з розбіжного контракту
  й це не впаде — воно тихо розійдеться в рантаймі.

#### Прогін B — клієнт

**S14 — хук домену брифа**
- Файли: `client/src/lib/hooks/brief.ts` (нове)
- Skills: `.claude/skills/frontend-architecture/SKILL.md` §10, §12
- `usePrBrief(prId)` (GET) і `useRebuildBrief(prId)` (POST) — форма
  `lib/hooks/intent.ts` цілком, включно з `enabled: !!prId` і
  `onSuccess: qc.setQueryData(...)` замість інвалідації (щоб картка не мигала
  через стан завантаження одразу після успіху).
- Ключі лишаються приватними для модуля; **у `lib/hooks/index.ts` нічого не
  додавати** — шосте `export *` там є помилкою ліну (`client/INSIGHTS.md`,
  2026-08-10). Імпорт прямий: `@/lib/hooks/brief`.
- Done when: типізується проти вендорованого `PrBriefView`; `pnpm lint` чистий.
- Verify: `cd client && pnpm typecheck && pnpm lint`
- Risk: `import { PrBriefView } from "@devdigest/shared"` як **значення** — +15 kB
  на кожному маршруті. Тільки `import type`.

**S15 — `PrBriefCard`, презентаційна (разом зі своїми ключами тексту)**
- Файли: `client/src/app/repos/[repoId]/pulls/[number]/_components/PrBriefCard/PrBriefCard.tsx`
  (нове) · `…/PrBriefCard/styles.ts` (нове) · `…/PrBriefCard/PrBriefCard.test.tsx` (нове) ·
  `client/messages/en/prReview.json` (доповнено ключами `brief.*`)
- Skills: `.claude/skills/frontend-architecture/SKILL.md` §4 ·
  `.claude/skills/react-best-practices/SKILL.md` — *Derive, Don't Store*, *Accessibility*
- **Ключі тексту додаються цим самим кроком**, а не наприкінці прогону: компонент,
  що рендерить ключ, якого ще немає в `messages/en/prReview.json`, не має жодного
  шансу пройти власний тест. S18 нижче — це аудит, а не місце, де ключі
  з'являються вперше.
- Пропси всередину, JSX назовні: жодного фетчингу, жодного `useState` для того,
  що виводиться з пропсів (`stale`, впорядковані ризики, зрізаний focus — усе в
  рендері). Хуки лишаються на `OverviewTab` (S16) — саме це дозволяє тесту
  вкладки довести, що картку хтось справді живить.
- Вміст: рівень ризику одним із трьох значень, **виділений кольором і присутній
  як текст** (AC-37, NFR-7); why/what (AC-38); ризики під рівнем ризику,
  впорядковані high → medium → low, всередині однакової важливості — у порядку
  сервера (AC-45); пояснення «ризики не вдалося підтвердити», коли
  `risks_grounded === false` (AC-46); секція Review Focus усередині **тієї самої**
  картки (AC-39), не більше десяти елементів (AC-40) з реальною кількістю, коли
  їх більше (AC-41); вартість і час виведення (AC-47) через наявний
  `RunCostBadge`-форматування; прочерк замість «$0.00» на невідомій вартості
  (AC-49); чип кешу за `reused` (AC-48); ознака застарілості за `stale` (AC-50),
  мовою наявного `IntentCard.tsx:76,90-94`; перелік відкинутих блоків (AC-56);
  кнопка регенерації (AC-51).
- **Порожній стан із закликом побудувати**, коли `brief === null` — окремо від
  стану завантаження (AC-53). Прийом `IntentCard.tsx:52-71`: гілка завантаження
  не рендерить **жодної дії**, бо клік у це вікно витрачає реальний виклик.
- **Чого на картці немає ніколи:** вердикту, лічильників знахідок, кількості
  блокерів, оцінки PR (AC-57). `VerdictBanner` не чіпається.
- Доступність (NFR-7): кожен елемент review focus активується з клавіатури й має
  доступне ім'я, що включає шлях; кнопка регенерації має доступне ім'я,
  **відмінне** від `Re-derive` картки наміру — на Overview після цієї фічі дві
  кнопки перегенерації поруч, і `client/INSIGHTS.md` (2026-08-10) фіксує рівно цей
  дефект в іншій частині цієї ж сторінки.
- **`messages/en/brief.json` не чіпати**: його ключі описують мертву
  чотириблокову форму `PrBrief` і є розширювальною точкою.
- Done when: `PrBriefCard.test.tsx` покриває AC-37…AC-41, AC-45…AC-51, AC-53,
  AC-56, AC-57, NFR-7 і половину AC-42 (клік по елементу викликає колбек із шляхом).
- Verify: `cd client && pnpm exec vitest run src/app/repos/\[repoId\]/pulls/\[number\]/_components/PrBriefCard/PrBriefCard.test.tsx`
- Risk: шлях до `messages/` із цієї теки — **вісім** рівнів угору; сім (інтуїтивна
  кількість) падає на імпорті без підказки. Скопіювати специфікатор із
  `RunTraceDrawer.test.tsx`.

**S16 — вкладка Overview: дані, стани, регенерація**
- Файли: `…/_components/OverviewTab/OverviewTab.tsx` (змінено) ·
  `…/_components/OverviewTab/OverviewTab.test.tsx` (доповнено, файл існує)
- Skills: `.claude/skills/next-best-practices/SKILL.md` — *Bundling* ·
  `.claude/skills/frontend-architecture/SKILL.md` §10
- Картка стає **над** парою `briefGrid` (AC-36), сам `briefGrid` не чіпається
  (`OverviewTab.tsx:52-69`).
- `usePrBrief` / `useRebuildBrief` живуть тут; у картку йдуть готові пропси.
- `loading` рахується з `isLoading`, **не** з `isPending`: із порожнім `prId`
  запит вимкнено й лишається pending назавжди (прийом `OverviewTab.tsx:55-58`).
- Кнопка регенерації недоступна, поки мутація в польоті (AC-52); невдала
  регенерація лишає попередній бриф на екрані (AC-55); помилка запиту — стан,
  відмінний від порожнього (AC-54).
- Вкладка приймає `onOpenFile(path: string)` і передає його картці — **свій проп,
  а не власний виклик роутера**: навігацію володіє `PrDetailView` (S17).
- Done when: `OverviewTab.test.tsx` доводить AC-36, AC-52, AC-54, AC-55 **із
  мокнутих даних API**, а не з переданих руками пропсів, і доводить, що клік по
  елементу review focus доходить до `onOpenFile` (середня ланка AC-42). Шелл
  мокнуто (`vi.mock("…/components/app-shell")`).
- Verify: `cd client && pnpm exec vitest run src/app/repos/\[repoId\]/pulls/\[number\]/_components/OverviewTab/OverviewTab.test.tsx`
- Risk: тест на рівні картки замість вкладки «зеленіє» й нічого не доводить —
  значок кількості скілів так прожив цілий лесон, жодного разу не з'явившись у
  застосунку.

**S17 — перехід «файл → вкладка зі змінами»**
- Файли: `…/_components/PrDetailView/PrDetailView.tsx` (змінено) ·
  `…/_components/PrDetailView/PrDetailView.test.tsx` (доповнено, файл існує) ·
  `…/_components/DiffTab/DiffTab.tsx` (змінено) ·
  `…/_components/SmartDiffViewer/SmartDiffViewer.tsx` (змінено) ·
  `…/_components/SmartDiffViewer/SmartDiffViewer.test.tsx` (доповнено) ·
  `client/src/components/diff-viewer/FileCard/FileCard.tsx` (змінено, мінімально)
- Skills: `.claude/skills/frontend-architecture/SKILL.md` §1 ·
  `.claude/skills/react-best-practices/SKILL.md` — *Derive, Don't Store*
- Новий параметр URL `?file=<path>` — **сусід** наявних `tab`, `view`, `finding`.
  Перехід іде одним `setParams({ tab: "diff", view: "smart", file: path }, { history: "push" })`
  — одна навігація, бо два однокльові сетери гонитимуться на одному рендері
  (`PrDetailView.tsx:70-101` пояснює це дослівно). `push`, не `replace`, щоб
  «Назад» повертав на Overview (AC-42).
- `DiffTab` приймає `selectedPath` і передає його в `SmartDiffViewer`;
  `SmartDiffViewer` вираховує `defaultOpen` для кожної картки як
  `file.path === selectedPath || !COLLAPSED_ROLES.includes(group.role)` (AC-43).
  `FileCard` міняється мінімально — його `useState`-ініціалізатор уже читає
  `smart.defaultOpen` (`FileCard.tsx:54-57`); додається лише атрибут шляху на
  заголовку картки, щоб тест міг її знайти.
- Файл, якого немає серед файлів PR: вкладка відкривається **без жодної обраної
  картки**, і це не помилка (AC-44).
- **Жодних якорів рядків**: ані `id`, ані `data-line` на `CodeLine` — фіча
  свідомо не повторює експеримент із `file:line` (`client/INSIGHTS.md`, 2026-08-13).
- Done when: `SmartDiffViewer.test.tsx` доводить AC-43 і AC-44 (ціль — картка, що
  **не перша** в списку), а `PrDetailView.test.tsx` доводить останню ланку AC-42:
  виклик `onOpenFile` з Overview лишає URL із `tab=diff`, `view=smart` і
  `file=<path>` **однією** навігацією типу `push`.
- Verify: `cd client && pnpm exec vitest run src/app/repos/\[repoId\]/pulls/\[number\]/_components/SmartDiffViewer src/app/repos/\[repoId\]/pulls/\[number\]/_components/PrDetailView`
- Risk: спроба довести **прокрутку**. Ані jsdom, ані наявна панель браузера її не
  спостерігають; AC-43 сформульовано як розгортання саме тому.

**S18 — аудит текстів і доступності**
- Файли: `client/messages/en/prReview.json` (правки за результатом аудиту, якщо є)
- Skills: `.claude/skills/react-best-practices/SKILL.md` — *Accessibility (HIGH)*
- Це **перевірка, а не місце появи ключів** (їх додав S15): жодного літерала
  UI-тексту в компонентах; плюралі — явні ICU (`{count, plural, one {…} other {…}}`),
  бо next-intl без них рендерить «1 findings» (`client/INSIGHTS.md`, 2026-08-06);
  доступні імена двох кнопок регенерації на Overview різні.
- Done when: аудит пройдено, або знайдене виправлено.
- Verify: `cd client && pnpm exec vitest run src/app/repos/\[repoId\]/pulls/\[number\]/_components`
- Risk: однакове доступне ім'я для двох сусідніх кнопок — уже описаний дефект на
  цій самій сторінці.

**S19 — перевірка клієнтської половини**
- Файли: жодного
- Done when: набір, типи й лінт зелені; **`pnpm build` при зупиненому `pnpm dev`**
  показує спільний чанк на рівні **102 kB** (NFR-6).
- Verify:
  `bash .claude/skills/pr-self-review/scripts/gates.sh --unit --only client`, далі
  окремо, зі зупиненим dev-сервером: `cd client && pnpm build`
- Risk: `pnpm build` при запущеному `pnpm dev` вбиває dev-сервер і забирає з ним
  увесь стек (`trap cleanup EXIT` у `scripts/dev.sh`); відновлення — `rm -rf
  client/.next` і перезапуск. Це також єдина перевірка, що ловить вендорну пастку
  `.js`→`.ts`, тож пропустити її не можна — її треба поставити окремо.

### Traceability

Кожен AC обох файлів має рядок. Тести названі так, як їх називає спека; файл, у
якому вони живуть, — у дужках першого входження.

| AC | Критерій (≤12 слів) | Крок | Тест | Примітка |
|---|---|---|---|---|
| AC-1 | вхід рівно з шести джерел | S4 | `test_brief_input` (`server/test/brief-sources.test.ts`) | — |
| AC-2 | тіла diff hunks не йдуть у модель | S4 | `test_brief_no_patch` | тип не має поля для `patch` |
| AC-3 | застарілий/відсутній intent деривується першим | S11 | `test_brief_intent_it` (`server/test/brief.it.test.ts`) | — |
| AC-4 | свіжий intent перевикористовується без виклику | S11 | `test_brief_intent_it` | — |
| AC-5 | відповідь несе кількість модельних викликів | S11, S12 | `test_brief_intent_it` | поле `model_calls` |
| AC-6 | рівно один структурований виклик п'яти полів | S6, S9 | `test_brief_call` (`server/test/brief-service.test.ts`) | — |
| AC-7 | allowlist із відповіді blast | S10 | `test_brief_grounding` | — |
| AC-8 | `degraded` → allowlist зі шляхів PR | S10 | `test_brief_grounding` | — |
| AC-9 | ризик поза allowlist відкинуто | S10 | `test_brief_grounding` | причина `ref outside allowlist` у лозі |
| AC-10 | focus поза allowlist відкинуто | S10 | `test_brief_grounding` | перевірка проти підмножини шляхів файлів |
| AC-11 | частка `N/M` у журналі завжди | S10 | `test_brief_grounding` | спільний тест із NFR-5; один лічильник на обидві причини |
| AC-12 | `risk_level` зберігається, коли ризики відкинуто | S10 | `test_brief_grounding` | — |
| AC-13 | focus — шлях + причина, без рядка | S6 | `test_brief_call` | — |
| AC-14 | один рядок на PR, із заміною | S2, S11 | `test_brief_cache_it` | — |
| AC-15 | provenance збережено разом із брифом | S2, S11 | `test_brief_cache_it` | — |
| AC-16 | збіг `head_sha` → без виклику моделі | S11 | `test_brief_cache_it` | стаб `llm()`, що кидає |
| AC-17 | розбіжність `head_sha` → позначка застарілості | S11 | `test_brief_cache_it` | — |
| AC-18 | регенерація перебудовує на незмінному head | S11 | `test_brief_cache_it` | — |
| AC-19 | понад 10 регенерацій за хвилину — відмова | S12 | `test_brief_routes_it` | — |
| AC-20 | ознака повторного використання | S11 | `test_brief_cache_it` | — |
| AC-21 | невідома вартість ≠ нуль | S9 | `test_brief_cost` | — |
| AC-22 | вимір токенів до відправлення | S7 | `test_brief_budget` (`server/test/brief-budget.test.ts`) | міряються зібрані повідомлення |
| AC-23 | наступний рівень тільки після вичерпання поточного | S7 | `test_brief_budget_order` | — |
| AC-24 | назва, резюме й перелік файлів невідкидні | S7 | `test_brief_budget` | — |
| AC-25 | відкинуті блоки перелічені у відповіді | S7 | `test_brief_budget` | тримає розходження зі SPEC-06 видимим |
| AC-26 | не влізло після всіх рівнів — гучна відмова | S7, S9 | `test_brief_budget` | throw — у S7; «виклику не було» — у S9 (`brief-service.test.ts`) |
| AC-27 | не більше одного раунду репару | S9 | `test_brief_call` | межа задана **явно** |
| AC-28 | кількість спроб збережено | S2, S9 | `test_brief_cache_it` | колонка `attempts` |
| AC-29 | невдалий виклик лишає старий бриф цілим | S11 | `test_brief_failure_it` | — |
| AC-30 | PR без ранів отримує повний бриф | S11 | `test_brief_no_runs_it` | — |
| AC-31 | бриф однаковий до й після рану | S11 | `test_brief_no_runs_it` | — |
| AC-32 | усі документи стору, за іменем | S4 | `test_brief_input_it` | — |
| AC-33 | текст issue зі статусом `used` — у вході | S3, S4 | `test_brief_input_it` | живий запит, R-3 |
| AC-34 | недоступний issue не ламає побудову | S3, S4 | `test_brief_input_it` | — |
| AC-35 | кожен недовірений блок позначено | S6 | `test_brief_prompt_guard` (`server/test/brief-prompt.test.ts`) | перелік секцій, `pr-title` включно |
| AC-36 | картка над парою наміру й досяжності | S16 | `OverviewTab.test.tsx` | з мокнутих даних API |
| AC-37 | рівень ризику одним із трьох, кольором | S15 | `PrBriefCard.test.tsx` | і текстом — NFR-7 |
| AC-38 | текст про те, що змінено й навіщо | S15 | `PrBriefCard.test.tsx` | — |
| AC-39 | Review Focus усередині тієї самої картки | S15 | `PrBriefCard.test.tsx` | — |
| AC-40 | не більше десяти елементів focus | S15 | `PrBriefCard.test.tsx` | — |
| AC-41 | справжня кількість, коли їх більше | S15 | `PrBriefCard.test.tsx` | — |
| AC-42 | активація елемента веде на вкладку зі змінами | S15, S16, S17 | `PrBriefCard.test.tsx` + `OverviewTab.test.tsx` + `PrDetailView.test.tsx` | три ланки: колбек → проп вкладки → URL одним `push` |
| AC-43 | картка обраного файлу розгорнута | S17 | `SmartDiffViewer.test.tsx` | ціль — не перша картка |
| AC-44 | невідомий файл — жодної обраної картки | S17 | `SmartDiffViewer.test.tsx` | — |
| AC-45 | ризики під рівнем, high → medium → low | S15 | `PrBriefCard.test.tsx` | — |
| AC-46 | пояснення, коли ризики не заземлено | S15 | `PrBriefCard.test.tsx` | — |
| AC-47 | вартість і час виведення | S15 | `PrBriefCard.test.tsx` | — |
| AC-48 | чип кешованого результату | S15 | `PrBriefCard.test.tsx` | — |
| AC-49 | невідома вартість — прочерк | S15 | `PrBriefCard.test.tsx` | — |
| AC-50 | ознака застарілості | S15 | `PrBriefCard.test.tsx` | — |
| AC-51 | кнопка регенерації присутня | S15 | `PrBriefCard.test.tsx` | — |
| AC-52 | кнопка недоступна, поки запит у польоті | S16 | `OverviewTab.test.tsx` | — |
| AC-53 | порожній стан із закликом, не порожня картка | S15 | `PrBriefCard.test.tsx` | живиться серверним AC-67 |
| AC-54 | стан помилки, відмінний від порожнього | S16 | `OverviewTab.test.tsx` | — |
| AC-55 | невдала регенерація лишає попередній бриф | S16 | `OverviewTab.test.tsx` | — |
| AC-56 | видно, які блоки входу відкинуто | S15 | `PrBriefCard.test.tsx` | — |
| AC-57 | ні вердикту, ні лічильників, ні оцінки | S15 | `PrBriefCard.test.tsx` | — |
| AC-58 | відповідь позначена як незаземлена | S10 | `test_brief_grounding` | незалежно від причини відкидання |
| AC-59 | недоступний issue — у переліку недоступних | S1, S2, S4, S11 | `test_brief_input_it` | поле `unavailable_inputs` + колонка |
| AC-60 | гард — останній у системному повідомленні | S6 | `test_brief_prompt_guard` | — |
| AC-61 | рівень 1: документи цілими, з кінця за іменем | S7 | `test_brief_budget_levels` | спрацьовує на кожній побудові |
| AC-62 | рівень 2: cron-записи | S7 | `test_brief_budget_levels` | — |
| AC-63 | рівень 3: endpoints | S7 | `test_brief_budget_levels` | — |
| AC-64 | рівень 4: викликачі понад п'ять на символ | S7 | `test_brief_budget_levels` | per-symbol; рендер (S5) не ріже |
| AC-65 | рівень 5: статистика понад 50 найбільших | S7 | `test_brief_budget_levels` | рендер (S5) не ріже |
| AC-66 | рівень 6: текст пов'язаного issue | S7 | `test_brief_budget_levels` | — |
| AC-67 | PR без брифа → порожній бриф, не помилка | S11, S12 | `test_brief_routes_it` | — |
| AC-68 | ризик без жодного посилання відкинуто | S10 | `test_brief_grounding` | окремий випадок; той самий `M`, той самий шлях, що в AC-9 |
| NFR-1 | ≤8 000 токенів, виміряно лічильником | S7, S8 | `test_brief_budget` | одиниця — зібрані повідомлення; число авторизує S8 |
| NFR-2 | `attempts ≤ 2` на побудову | S9 | `test_brief_call` | транспортні ретраї поза межами |
| NFR-3 | 0 / 1 / 2 виклики за сценарієм | S11 | `test_brief_cache_it` | — |
| NFR-4 | нуль незагорнутих недовірених блоків | S6 | `test_brief_prompt_guard` | — |
| NFR-5 | рядок заземлення у 100 % побудов | S10 | `test_brief_grounding` | спільний тест із AC-11 |
| NFR-6 | спільний чанк лишається 102 kB | S19 | — (`pnpm build`, вручну, один раз) | автоматичного бюджету пакета в репо немає |
| NFR-7 | клавіатура + рівень ризику текстом | S15, S18 | `PrBriefCard.test.tsx` | різні доступні імена двох кнопок |
| NFR-8 | нуль тихих скорочень | S5, S7 | `test_brief_budget` | S5 не ріже; S7 звітує кожне відкидання |

### Companion changes

`routing.md` §5, прогнано по всьому набору змін один раз:

| Набір містить | Мусить також містити | Крок |
|---|---|---|
| зміну схеми + міграцію | торкнутий `*.it.test.ts` | S11, S12 (`brief.it.test.ts`) |
| нові маршрути | валідацію, шлях авторизації, тест | S12 (`IdParams` + `response`, `getContext`, `test_brief_routes_it`) |
| новий сервіс і репозиторій | проводку в композиційному корені | S3 (`container.blast`), S12 (`modules/index.ts`) |
| змінений Zod-контракт | **обидві** вендоровані копії + місця виклику на клієнті | S1 (вендор), S13 (`--check`), S14–S16 (виклики) |
| новий шлях у модель | застосований `INJECTION_GUARD` | S6 |
| код, що впливає на findings/scoring | заземлення досі відкидає незацитоване | S10 (форма `groundFindings`; шлях рев'ю не змінюється) |
| нове читання секрета | `SecretsProvider`, не голий `process.env` | немає нових читань — GitHub і LLM приходять із контейнера |

Окремо, чого набір **не** містить і чому: жодного `e2e/specs/*.flow.json` —
клієнтська спека відмовляється від нього явно (прокрутку це середовище не
спостерігає), і замовляти його треба окремо.

### End-to-end verification

Після S19, у такому порядку:

1. `./scripts/vendor-shared.sh --check` — копії контрактів ідентичні.
2. `bash .claude/skills/pr-self-review/scripts/gates.sh --unit --only server`
3. `cd server && pnpm exec vitest run` — **увесь** серверний набір, з
   `*.it.test.ts`. Крок 2 їх виключає за іменем файлу (`gates.sh:8-17`), тож без
   цього рядка інтеграційний шар фічі лишається неперевіреним. Потрібен Docker;
   **не** проти стека з живими ранами (`buildApp` реапить `running` без скоупу).
4. `bash .claude/skills/pr-self-review/scripts/gates.sh --unit --only client`
5. Зі **зупиненим** `pnpm dev`: `cd client && pnpm build` — спільний чанк 102 kB
   (NFR-6) і вендорна пастка `.js`→`.ts`.
6. **Ручна перевірка на живому стеку — вона витрачає гроші.** `./scripts/dev.sh`,
   і перш ніж тиснути «побудувати»: переконатись, що ключ провайдера налаштований
   (`~/.devdigest/secrets.json` або `process.env` — інакше `ConfigError`, і це
   правильна поведінка, а не дефект), і знати, що кожна побудова — це 1 реальний
   виклик, 2 на PR без свіжого intent. Сценарій: відкрити PR → картка в порожньому
   стані → «побудувати» → бриф із рівнем ризику, ризиками й Review Focus → клік по
   елементу focus відкриває вкладку зі змінами з розгорнутою карткою того файлу →
   «Назад» повертає на Overview → повторне відкриття PR показує чип кешу й **нуль**
   нових викликів у лозі.

### Out of scope

- **«Why Timeline»** — історія брифів по комітах (UX-1). Один рядок на PR, upsert.
- **Злиття брифа з `VerdictBanner`** (UX-4) і будь-яка його зміна: банер лишається
  у `?tab=findings`.
- **Зміна `IntentCard`, `BlastRadiusCard` і контракту `Intent`.**
- **Якорі рядків у дифі** — ані `id`, ані `data-line` на `CodeLine`.
- **Релевантність документів project context** — механізму не існує; беруться всі.
- **Зміни у `reviewer-core`** — лише імпорт двох символів.
- **Інвалідація кешу по `indexed_sha`, `updated_at` документа, версії моделі чи
  тексту промпту** (UX-2 і знахідка рев'ю): ключ — тільки `head_sha`, як записано
  в спеці. Рядок у *Open decisions*.
- **Окрема метрика для ризиків, відкинутих за AC-68.** Спека вирішила це явно:
  один `N/M` на обидві причини, розрізнення — у журналі (S10).
- **`.min(1)` на `Risk.file_refs` у контракті чи в модель-фейсінг схемі.**
  Порожній масив легальний на вході; відкидає його заземлення (AC-68), а не
  парсер, — інакше це коштувало б раунду схема-репару, який обмежує NFR-2.
- **Механічна перевірка «резюме не переказує назву PR»** (UX-5) — лишається
  інструкцією промпту.
- **Оптимізація подвійного запиту issue на холодному PR.** Свідомо прийнята ціна:
  на PR без свіжого intent той самий issue тягнеться двічі — раз у
  `collectSources` під час деривації (`intent/pipeline/sources.ts:283`), раз у
  збирачі брифа. Прибирається лише розширенням `DeriveOutcome`, тобто правкою
  чужого модуля; власник вибрав просту форму (Assumption 1).
- **Правка `messages/en/brief.json`** — неймспейс описує мертву форму `PrBrief` і
  лишається розширювальною точкою.
- **Зміна NFR-1 за результатом виміру.** Якщо S8 покаже розходження — число
  повертається `spec-creator`-ові; план його не редагує.

### Open decisions / Not established

| Відкрите питання | Де я дивився | Чому досі відкрите | Що це закриє |
|---|---|---|---|
| Скільки реально важить зібраний промпт брифа на PR цього репо | `repo-intel/constants.ts`, `blast/constants.ts`, `context/constants.ts:26`, `intent/constants.ts` — усі капи прочитані; паперова оцінка 5 000–7 000 без документів і **без** ваги системного промпту й обгорток | Виміряти без піднятої БД і реальних імпортованих PR неможливо, а планування не піднімає стек | S8: `pnpm measure:brief --pr <uuid>` на трьох реальних PR |
| Чи законно перевіряти `review_focus.path` проти **підмножини** allowlist (без маршрутів endpoints) | AC-7, AC-10, клієнтські AC-42/AC-44 | AC-10 вимагає відкидати те, що поза списком, і не забороняє відкидати більше; підмножина строгіша й дає клієнту тільки те, що він може відкрити. Але це **інтерпретація**, і вона має бути видимою | Підтвердження власника або окремий AC про різні списки для ризиків і focus |
| Чи прийнятно, що зміна моделі або тексту промпту не інвалідує бриф на тому ж `head_sha` | AC-16, open question спеки про ключ кешу | Ключ кешу — вимога; додати до нього версію промпту означало б змінити AC-16 | Рішення `spec-creator` (наприклад, `prompt_version` у ключі) |
| Чи не зробить AC-24 гучну відмову (AC-26) звичайною на великих PR | AC-24 і open question спеки; `intent/constants.ts:MAX_CHANGED_FILES = 60` як контраст | Спека свідомо лишила перелік файлів невідкидним; альтернативу («показано N з M») вона назвала й не взяла | Рішення власника продукту або перший PR у 400 файлів, що впав на AC-26 |
| Чи прийнятно, що в репо з одним документом project context бриф системно будується **без** проєктного контексту | блок під AC-61; `context/constants.ts:26` | Прямий наслідок AC-61 + `MAX_DOC_BYTES`; спека це зафіксувала, але не змінила | Рішення власника: кап на документ у збирачі брифа або більший бюджет — обидва є зміною вимоги |
| `cl100k_base` — не токенізатор цільової моделі | `adapters/tokenizer/index.ts:31-46`, один лічильник на всі провайдери | Для не-OpenAI провайдерів 8 000 — наближення, і AC-26 вперше робить його вирішальним | Порівняння виміру S8 з `usage.prompt_tokens` першої реальної побудови |
| Чи потрібен `ContainerOverrides.blast` для тестів | `platform/container.ts:55-79` — overrides є для `llm`, `github`, `repoIntel`, `tokenizer`, `projectContext`, `contextRepo` | Наявних вистачає: `BlastService` будується над підміненим `repoIntel`. Додавати запис наперед — вгадувати | Перший тест S10/S11, якому справді не вистачить наявних |
| Немає стандарту доступності, проти якого писати NFR-7 | обидві спеки, open questions; пошук по спеках за `a11y`/`WCAG`/`aria` дає нуль | NFR-7 написано у спостережуваних термінах, але це вже друга така вимога в репо | Рішення власника продукту про стандарт (не блокує цей план) |
