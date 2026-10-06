# TODO: задачи для локальной машины

Рабочий список мейнтейнера. Источник плана: [План: безопасность агентного UI](https://claude.ai/artifact/DARKTXxuaYovCfDhgxdRZa) (приватный документ). Техническое зеркало плана: `ROADMAP.md`. Порядок ниже соответствует плану: раскрытие → библиотека → перепись → evil-mcp-app.

Maintainer's working list, kept in Russian on purpose; the public documentation is in English.

## 1. Настройки, по пять минут каждая (без них часть автоматики не работает)

- [ ] GitHub → Settings → Pages → Source: **GitHub Actions**. После этого `pages.yml` начнёт деплоить демо на https://shteynu.github.io/render-policy/ (сейчас каждый запуск падает с «Resource not accessible by integration»).
- [ ] GitHub → Settings → Code security → **Private vulnerability reporting: enable**. На это ссылаются `SECURITY.md` и шаблоны issue.
- [~] npm: организация `render-policy` создана 2026-10-06. Осталось сгенерировать automation-токен, положить в GitHub → Settings → Secrets → Actions как `NPM_TOKEN`. Без токена release-workflow только прикладывает тарболы к GitHub Release.
- [ ] Проверить, что Dependabot создал первые PR (`.github/dependabot.yml`); группа `security-critical` (DOMPurify, marked) требует ручного взгляда на changelog перед merge.

## 2. Релиз v0.1.0

- [x] Версии всех шести пакетов (включая `mcp-app-lint`) `0.1.0`; в `CHANGELOG.md` дата 2026-09-30.
- [x] Проверка тарболов перед публикацией: `npm pack` всех шести, publint и arethetypeswrong чистые (ESM-only предупреждение ожидаемо), установка в чистый проект: ESM-импорт, `require()`, типы под `node16` и `bundler`, `@render-policy/core/internal` через `typesVersions`; LICENSE лежит в каждом пакете.
- [ ] `npm ci && npm run check` локально (нужен Chromium: `npx playwright install chromium`).
- [x] `git tag v0.1.0 && git push origin v0.1.0` → `release.yml`: проверки, сверка версий с тегом, тарболы на GitHub Release. `NPM_TOKEN` не было, поэтому 0.1.0 опубликован на npm 2026-10-06 вручную с локальной машины (без provenance; 2FA ключом безопасности через браузер). Следующие версии: через `release.yml` с токеном, тогда будет provenance.
- [x] После публикации: в `README.md` убран блок «install from release tarballs», `npm install @render-policy/core` в чистом проекте работает.

## 3. Перепись CSP: протокольный обход (нужна обычная сеть, из облачной сессии не работает)

```
npm ci && npm run build
npm run census:registry          # снимок реестра, ~10 минут; чекпоинты, флаг --budget-seconds N
npm run census:remote            # 22 618 streamable-http серверов; возобновляемый
npm run census:report            # census/SUMMARY.md и census/data/summary.json
```

- [ ] Оценить время: `node census/collect-remote.mjs --limit 200 --concurrency 8`, посмотреть долю `auth`/`network`/`not-mcp`, затем полный прогон (ожидание: часы, а не минуты; можно частями, записи не дублируются).
- [ ] Закоммитить только `census/SUMMARY.md` и `census/data/summary.json`; сырые данные в `census/data/` не коммитятся.
- [ ] Опасные находки по конкретным серверам (например, `connectDomains` со стоком, `resources/read` шире `resources/list`) сообщать владельцам приватно до публикации; правило в `census/README.md`.
- [ ] Отдельно решить, запускать ли stdio-серверы (npm-пакеты) в контейнере; сейчас не делается.

## 4. Публикация по переписи (Этап 3 плана, до 27 ноября)

- [x] Черновик статьи на данных: `docs/writeup-mcp-apps-census.md` (реестр 37 759 серверов, 62% с remote; 168 пакетов с UI SDK, 153 с UI-ресурсами, CSP объявляют 39%, 4 разрешают любой хост через `*` или `https:`; 596 HTML-документов, `innerHTML`-сток в рукописных скриптах у 17%; категории объявленных хостов).
- [ ] После протокольного обхода вставить в статью раздел «Live policies» (доля CSP, wildcard'ы, расхождение list/read, инструменты с побочными эффектами, видимые UI) и вычитать.
- [ ] Не называть непочиненные серверы; агрегаты и метод; скрипт уже открыт в `census/`.
- [ ] При необходимости вынести перепись в отдельный репозиторий: `git subtree split -P census -b census-only`.
- [ ] Заявки на доклады; пост после публикации.

## 5. Шаг 1 плана: раскрытие (письмо уже отправлено)

- [ ] Сроки по их политике: подтверждение 48 часов, разбор 5 рабочих дней, исправление 30 дней. Без ответа — напоминание в их Discord без технических деталей.
- [ ] После выхода исправления: публичный разбор без рабочей нагрузки, ссылка в `README.md` render-policy, предложение render-policy как слоя безопасности для их Angular-пакета.
- [ ] До исправления в репозитории не появляется ни имя вендора, ни номер advisory (правило в `CLAUDE.md`).

## 6. Библиотека: следующие задачи

- [ ] Стриминг v2: перепарсинг только незавершённого хвоста. Попытка (сканер границ в `settle.ts`) откачена: строгий property-тест на эквивалентность с полным рендером находил нелокальные случаи Markdown (ссылочные определения, «рыхлые» списки, растущая последняя строка). Пока рендерится весь буфер с патчем хвоста (`patchChildren`); property-тест — планка приёмки для будущей версии. Push: 2 ms при 8 kB, 17 ms при 64 kB.
- [x] React: `onDecisions` и для стримингового режима (через `createContentBinding`, `end()` возвращает решения).
- [ ] Angular: тесты на TestBed поверх существующего браузерного прогона; мост для ngx-markdown отложен (ngx-markdown пишет в `innerHTML`, мост стал бы заменой компонента).
- [ ] Гайд по image proxy для `rewriteImageUrl` (защита от SSRF на стороне прокси).
- [x] Из ревью дизайна: `RenderPolicy` сгруппирован в `content / urls / images` с послойным merge; хук политики URL `urls.decide(url, context)` (allow / deny / rewrite для ссылок и картинок). Сделано до релиза, пока нет пользователей.
- [ ] Остаток ревью дизайна (не ломает API, можно после релиза): конвейер атрибутных правил вместо одного хука в `sanitize.ts`; разбить mermaid-трансформ на кэш и обёртку; JSDoc-типы для `mcp-app-lint`.
- [ ] Ревизия стартового denylist стоков (`packages/core/src/data/sink-domains.ts`), версия в поле `version`.
- [ ] Ещё раз взвесить дефолт `balanced`: пустой allowlist картинок блокирует все удалённые картинки, пока хост не перечислен (осознанный выбор, описан в README).
- [ ] Корпус: новые кейсы → `npm run corpus:results` → коммит `corpus/RESULTS.md`.
- [ ] A2UI: внести раздел «Proposed: structured agent UI (A2UI)» из `ROADMAP.md` в приватный план и поставить даты. Решить открытые вопросы: отдельный пакет или вход в core, какую версию спецификации брать первой (v0.9 или v1.0), как проверять результат `formatString`. Первые шаги: `guardA2uiValue` и строгий режим для `Text`.

## 7. Этап 4 плана (с 30 ноября): evil-mcp-app и правила для сканеров

- [~] Начато как харнесс соответствия в `conformance/`: эталонная сборка CSP и `allow` из `_meta.ui` (спека SEP-1865), юнит-тесты против формулы спеки, прогон в Chromium (объявленные хосты доступны, необъявленные заблокированы, рестриктивный дефолт без метаданных, `frame-src`/`object-src`/`base-uri` закрыты, разные origin у хоста и песочницы). Осталось: полный двойной sandbox-proxy с релеем сообщений, согласие на вызов инструментов, подделка `ui/message` и `sandbox-*`, `open-link` с опасными схемами — это требует драйвера-хоста, отдельным заходом.
- [ ] Табели для open-source и встраиваемых хостов из плана; закрытые хосты только вручную по правилам их баунти-программ.
- [x] `mcp-app-lint`: прототип в `packages/mcp-app-lint` (18 SARIF-правил из анализатора переписи, CLI: `--dir`, `--package`, `--read/--list/--tools`, `--html`).
- [ ] `mcp-app-lint`: прогнать по реальным пакетам из переписи (`npx mcp-app-lint --package <name>`), поправить ложные срабатывания; PR хотя бы в один MCP-сканер.
- [x] GitHub Action для `mcp-app-lint` (`action.yml`, composite): запуск сканера и загрузка SARIF в code scanning; SARIF-пути сделаны репо-относительными. Готово к использованию как `uses: shteynu/render-policy@v1` после публикации тега.
- [ ] Предложить набор в ext-apps как проверку соответствия хостов.

## 8. Этапы 5–6 плана (деньги и enterprise), с вашим участием

- [ ] Одностраничник услуги «аудит агентного UI» с примером табеля.
- [ ] Список 10 целевых компаний со своим copilot'ом; начать с израильских.
- [ ] Заявки на гранты (OpenAI, Alpha-Omega).
- [ ] С GA Copilot Studio: следить за моделью допуска сторонних MCP-приложений; 10–15 интервью с админами M365; прототип только при 3+ сильных сигналах.
- [ ] Точка решения 2027-04-05 по порогам из плана.
