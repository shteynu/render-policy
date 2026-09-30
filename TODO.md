# TODO: задачи для локальной машины

Рабочий список мейнтейнера. Источник плана: [План: безопасность агентного UI](https://claude.ai/artifact/DARKTXxuaYovCfDhgxdRZa) (приватный документ). Техническое зеркало плана: `ROADMAP.md`. Порядок ниже соответствует плану: раскрытие → библиотека → перепись → evil-mcp-app.

Maintainer's working list, kept in Russian on purpose; the public documentation is in English.

## 1. Настройки, по пять минут каждая (без них часть автоматики не работает)

- [ ] GitHub → Settings → Pages → Source: **GitHub Actions**. После этого `pages.yml` начнёт деплоить демо на https://shteynu.github.io/render-policy/ (сейчас каждый запуск падает с «Resource not accessible by integration»).
- [ ] GitHub → Settings → Code security → **Private vulnerability reporting: enable**. На это ссылаются `SECURITY.md` и шаблоны issue.
- [ ] npm: создать организацию `render-policy` (скоуп `@render-policy`), сгенерировать automation-токен, положить в GitHub → Settings → Secrets → Actions как `NPM_TOKEN`. Без токена release-workflow только прикладывает тарболы к GitHub Release.
- [ ] Проверить, что Dependabot создал первые PR (`.github/dependabot.yml`); группа `security-critical` (DOMPurify, marked) требует ручного взгляда на changelog перед merge.

## 2. Релиз v0.1.0

- [ ] Версии всех пяти пакетов сейчас `0.1.0`; в `CHANGELOG.md` заменить «(unreleased)» на дату.
- [ ] `npm ci && npm run check` локально (нужен Chromium: `npx playwright install chromium`).
- [ ] `git tag v0.1.0 && git push origin v0.1.0` → `release.yml`: проверки, сверка версий с тегом, тарболы на GitHub Release, публикация на npm с provenance при наличии `NPM_TOKEN` (порядок: core, eslint-plugin, react, mermaid, angular из `packages/angular/dist`).
- [ ] После публикации: в `README.md` убрать блок «install from release tarballs», проверить `npm install @render-policy/core` в чистом проекте.

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

- [ ] Черновик статьи на данных: реестр (37 759 серверов, 62% с remote), 168 пакетов с UI SDK, 153 с UI-ресурсами, CSP объявляют 39%, 596 HTML-документов, `innerHTML`-сток в рукописных скриптах у 17%; добавить результаты протокольного обхода (доля CSP, wildcard'ы, расхождение list/read, инструменты с побочными эффектами, видимые UI).
- [ ] Не называть непочиненные серверы; агрегаты и метод; скрипт уже открыт в `census/`.
- [ ] При необходимости вынести перепись в отдельный репозиторий: `git subtree split -P census -b census-only`.
- [ ] Заявки на доклады; пост после публикации.

## 5. Шаг 1 плана: раскрытие (письмо уже отправлено)

- [ ] Сроки по их политике: подтверждение 48 часов, разбор 5 рабочих дней, исправление 30 дней. Без ответа — напоминание в их Discord без технических деталей.
- [ ] После выхода исправления: публичный разбор без рабочей нагрузки, ссылка в `README.md` render-policy, предложение render-policy как слоя безопасности для их Angular-пакета.
- [ ] До исправления в репозитории не появляется ни имя вендора, ни номер advisory (правило в `CLAUDE.md`).

## 6. Библиотека: следующие задачи

- [ ] Стриминг v2: перепарсинг только незавершённого хвоста Markdown вместо всего буфера (сейчас патчится только DOM).
- [ ] React: `onDecisions` и для стримингового режима (сейчас только для one-shot).
- [ ] Angular: тесты на TestBed поверх существующего браузерного прогона; мост для ngx-markdown отложен (ngx-markdown пишет в `innerHTML`, мост стал бы заменой компонента).
- [ ] Гайд по image proxy для `rewriteImageUrl` (защита от SSRF на стороне прокси).
- [ ] Ревизия стартового denylist стоков (`packages/core/src/data/sink-domains.ts`), версия в поле `version`.
- [ ] Ещё раз взвесить дефолт `balanced`: пустой allowlist картинок блокирует все удалённые картинки, пока хост не перечислен (осознанный выбор, описан в README).
- [ ] Корпус: новые кейсы → `npm run corpus:results` → коммит `corpus/RESULTS.md`.

## 7. Этап 4 плана (с 30 ноября): evil-mcp-app и правила для сканеров

- [ ] Набор на Playwright со злым MCP-сервером: изоляция и origin песочницы, подделка `sandbox-*` сообщений, `postMessage` с `"*"`, вызовы инструментов из UI без согласия, `ui/message` от имени пользователя, `open-link` с опасными схемами, выход данных через формы и навигацию фрейма, поддельный интерфейс согласия.
- [ ] Табели для open-source и встраиваемых хостов из плана; закрытые хосты только вручную по правилам их баунти-программ.
- [ ] `mcp-app-lint`: SARIF-правила из `census/lib/analyze.mjs` для существующих MCP-сканеров; PR хотя бы в один.
- [ ] Предложить набор в ext-apps как проверку соответствия хостов.

## 8. Этапы 5–6 плана (деньги и enterprise), с вашим участием

- [ ] Одностраничник услуги «аудит агентного UI» с примером табеля.
- [ ] Список 10 целевых компаний со своим copilot'ом; начать с израильских.
- [ ] Заявки на гранты (OpenAI, Alpha-Omega).
- [ ] С GA Copilot Studio: следить за моделью допуска сторонних MCP-приложений; 10–15 интервью с админами M365; прототип только при 3+ сильных сигналах.
- [ ] Точка решения 2027-04-05 по порогам из плана.
