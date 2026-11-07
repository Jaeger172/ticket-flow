# 3. Контракты взаимодействия

## Машиночитаемые спецификации

| Файл | Формат | Область |
|---|---|---|
| [orders.openapi.yaml](contracts/orders.openapi.yaml) | OpenAPI 3.0.3 | API покупателя |
| [reservations.openapi.yaml](contracts/reservations.openapi.yaml) | OpenAPI 3.0.3 | Публичный каталог и внутренние команды резервирования |
| [payments.openapi.yaml](contracts/payments.openapi.yaml) | OpenAPI 3.0.3 | Внутренняя оплата / отмена и подписанный webhook |
| [provider-simulator.openapi.yaml](contracts/provider-simulator.openapi.yaml) | OpenAPI 3.0.3 | Контракт внешнего имитатора, включая сверку и возврат |
| [events.asyncapi.yaml](contracts/events.asyncapi.yaml) | AsyncAPI 2.6.0 | Десять типов доменных событий |

Четвёртый OpenAPI фиксирует требования к имитатору провайдера, а не добавляет четвёртый бизнес-сервис Ticket Flow. Реального банка, реальных карт и денежных переводов в учебной реализации нет.

## Общие правила HTTP

- Идентификаторы — UUID. Orders заранее сохраняет `orderId`, `reservationId`, `paymentId`; на всём пути покупки они неизменяемы. `customerId` — строка из JWT `sub`.
- Деньги — положительный `amountMinor` типа int64 в копейках и `currency=RUB`. UI не задаёт цену; Orders получает её из Reservations и отправляет доверенным вызовом Payments. Лимит демонстрационной цены — 1 000 000 000 копеек; реализация должна исключить переполнение.
- Даты — UTC / RFC 3339. На границе срока резерв не подтверждается: допустимо только `now < expiresAt`.
- `X-Correlation-Id` — UUID для трассировки, в Saga равен `orderId`. Ошибка содержит `code`, `message`, `correlationId`; технические stack traces клиенту не выдаются.
- Все бизнес-команды требуют `Idempotency-Key`. Хранилище ключей атомарно связывает caller, метод / путь, ключ, хеш тела и результат / ID ресурса. Конкурентные повторы сериализуются; другой payload под тем же ключом даёт 409. При незавершённой обработке допустим повтор после временной ошибки с прежним ключом.
- Повтор POST заказа возвращает тот же ID и текущий снимок. Успешный повтор внутренней команды возвращает актуальное состояние прежнего ресурса; старый `HELD` не считается новым резервом. Окончательный бизнес-отказ той же команды сохраняется под ключом. Повторные неуспешные временные обращения не кэшируются как постоянный отказ.
- Для внутренних команд дополнительная защита — стабильный ID и уникальные бизнес-ограничения: новый ключ не позволяет создать второй платёж по тому же заказу.
- Публичные изменяющие запросы требуют JWT покупателя, внутренние — сервисный токен. Доступ к чужому заказу возвращает 404. Каталог публичный.
- 202 означает, что операция надёжно принята, но бизнес-процесс ещё не завершён. 503 / timeout не доказывают отсутствие эффекта; нужно читать по ID или повторять исходный запрос. 409 означает бизнес-конфликт и требует разбора текущего состояния.

Стабильные ключи команд: `{orderId}:reserve`, `{orderId}:confirm`, `{orderId}:release`, `{orderId}:pay`, `{orderId}:cancel-pay`. Payments использует у провайдера `{paymentId}:charge`, `{paymentId}:cancel`, `{paymentId}:refund`. Ключи операций различаются; новый сетевой retry не меняет ключ.

## Синхронные операции

| Инициатор → получатель | Метод и путь | Результат |
|---|---|---|
| UI → Orders | `POST /orders` | 202: заказ и шаг сохранены; 200 при повторе |
| UI → Orders | `GET /orders/{orderId}` | Состояние, готовая ссылка на оплату, билет при CONFIRMED |
| UI → Reservations | `GET /events` | Мероприятия |
| UI → Reservations | `GET /events/{eventId}/seats` | Справочная доступность и цены |
| Orders → Reservations | `PUT /internal/reservations/{reservationId}` | Создать HELD или вернуть прежний ресурс |
| Orders → Reservations | `GET /internal/reservations/{reservationId}` | Разрешить неопределённый результат |
| Orders → Reservations | `POST /internal/reservations/{reservationId}/confirmation` | Закрепить HELD; при истечении — 409 |
| Orders → Reservations | `PUT /internal/reservations/{reservationId}/release` | Освободить либо сохранить запрет позднего создания |
| Orders → Payments | `PUT /internal/payments/{paymentId}` | Создать локальную запись и задание провайдеру |
| Orders → Payments | `GET /internal/payments/{paymentId}` | Локальное состояние и готовая paymentUrl |
| Orders → Payments | `PUT /internal/payments/{paymentId}/cancellation` | Отмена либо полный возврат; 202 пока результат неизвестен |
| Payments → Provider | `PUT /charges/{paymentId}` | Создать платёжную страницу с идемпотентным ID |
| Payments → Provider | `GET /charges/{paymentId}` | Финансовая истина для сверки |
| Payments → Provider | `PUT /charges/{paymentId}/cancellation` | Запретить будущее списание; CAPTURED требует refund |
| Payments → Provider | `PUT /charges/{paymentId}/refund` | Полный возврат; повтор без второго эффекта |
| Provider → Payments | `POST /webhooks/provider` | Подписанный callback надёжно сохранён, 202 |
| Браузер → Provider | `GET /pay/{paymentId}` | Страница имитатора оплаты |
| Тестовый сценарий → Provider | `POST /demo/charges/{paymentId}/outcome` | Задать отказ / списание и задержку callback; только демо |

## Защита от поздних команд

`release` и `cancellation` при ещё не существующем ID создают **tombstone** — запись с владельцем и конечным состоянием. Поздний create под этим ID получает 409 и не запускает бизнес-операцию. У нормального резерва / платежа `tombstone=false`; у такой защитной записи `tombstone=true`. Это явно отражено в схемах ответов `oneOf`.

Старый резерв освобождается по `reservationId`. Освобождение по одному `seatId` запрещено: место после истечения срока уже мог занять другой покупатель. Освобождение подтверждённого резерва возвращает 409 — пользовательского возврата после выдачи билета в MVP нет.

Payments сначала сохраняет цель отмены и задание, затем общается с провайдером. Когда исход создания неизвестен, он отменяет / сверяет тот же merchantPaymentId. У имитатора отмена неизвестного ID также оставляет tombstone. Если реальный провайдер не поддерживает это поведение, адаптер потребует отдельного решения; текущий контракт нельзя считать гарантией произвольного банка.

## События

AsyncAPI описан **с позиции Orders**: `subscribe` — Orders получает, `publish` — Orders отправляет. Фактический издатель указан в `x-producer`. HTTP-команды в брокер не отправляются.

| Канал / routing key | Тип события | Издатель | Потребитель и смысл |
|---|---|---|---|
| `reservation.held.v1` | ReservationHeld | Reservations | Orders: факт резерва и снимок цены |
| `reservation.confirmed.v1` | ReservationConfirmed | Reservations | Orders: результат подтверждения, включая потерянный HTTP-ответ |
| `reservation.released.v1` | ReservationReleased | Reservations | Orders: освобождение / tombstone |
| `reservation.expired.v1` | ReservationExpired | Reservations | Orders: срок истёк, требуется компенсация |
| `payment.succeeded.v1` | PaymentSucceeded | Payments | Orders: доказанное списание; подтвердить место или продолжить отмену |
| `payment.failed.v1` | PaymentFailed | Payments | Orders: окончательный отказ, освободить место |
| `payment.cancelled.v1` | PaymentCancelled | Payments | Orders: доказана отмена без списания |
| `payment.refunded.v1` | PaymentRefunded | Payments | Orders: полный возврат подтверждён |
| `order.confirmed.v1` | OrderConfirmed | Orders | Информационный результат, обязательного подписчика в MVP нет |
| `order.cancelled.v1` | OrderCancelled | Orders | Информационный результат после завершённых компенсаций |

В `OrderCancelled` предвыделенные `reservationId` / `paymentId` не доказывают, что ресурсы создавались; `reason` объясняет завершение. `PaymentSucceeded` означает финансовый факт CAPTURED, даже если целевой исход уже «отменить»; он не обещает, что текущий платёж всё ещё SUCCEEDED.

### Конверт сообщения

| Поле | Назначение |
|---|---|
| messageId | UUID конкретного события; сохраняется при повторной отправке |
| eventType | Одно из имён таблицы выше |
| occurredAt | Время фиксации бизнес-факта |
| correlationId | orderId для сквозной трассировки |
| causationId | Ключ команды, ID входящего события либо ID фоновой операции |
| aggregateId | reservationId, paymentId или orderId издателя |
| aggregateVersion | Монотонная версия агрегата у издателя; не глобальный порядок |
| data | Поля конкретного факта по схеме AsyncAPI |

HTTP-ответ и событие могут содержать один результат. Inbox дедуплицирует сообщения, а допустимые переходы и уникальные ограничения защищают бизнес-эффект независимо от транспорта. При конфликте события и локального снимка сервис читает актуальный ресурс; нельзя вслепую присваивать статус из события.

### Реакции оркестратора

| Факт | Действие Orders |
|---|---|
| HELD | Сохранить неизменяемые данные; создать оплату только если заказ ещё идёт к покупке |
| PaymentSucceeded | Проверить ID / сумму / валюту; если нет cancelRequested — подтвердить резерв, иначе запросить возврат |
| ReservationConfirmed | Убедиться в успешном платеже; завершить билет. Неожиданный факт сначала сверить |
| ReservationExpired / Released | Не возвращать заказ к продаже; запустить / продолжить компенсацию |
| PaymentFailed / Cancelled / Refunded | Освободить старый резерв; завершить CANCELLED только после обоих конечных результатов |
| Повтор или старый факт | Сохранить факт без повторного эффекта; при несогласованности прочитать владельца данных |

Если `ReservationExpired` пришёл во время неизвестного результата confirm, актуальный GET разрешает исход: терминальные EXPIRED и CONFIRMED одного резерва несовместимы. Заказ не входит в компенсацию при ещё не разрешённом результате ранее посланного подтверждения.

## Webhook провайдера

`X-Provider-Signature = hex(HMAC-SHA256(secret, timestamp + "." + rawBody))`. Подпись сравнивается безопасно, `X-Provider-Timestamp` допускает отклонение 300 секунд. При повторной доставке провайдер подписывает тело свежим timestamp, сохраняя callbackId и финансовый факт. Поэтому задержанный callback не обходится старой подписью.

Ответ 202 отправляется после commit записи callback и изменения / задания сверки. Неизвестный ID не создаёт заказ или платёж; факт сохраняется для диагностики. При CAPTURED / REFUNDED сумма и валюта обязаны совпадать. Старые версии не откатывают состояние; спорный результат разрешается GET провайдера. Переход браузера назад на сайт не заменяет webhook.

## Локальные ограничения данных

| Сервис | Ключевые ограничения |
|---|---|
| Orders | UNIQUE(customerId, idempotencyKey, operation), UNIQUE(tickets.orderId), UNIQUE(ticketId), UNIQUE(consumer, messageId), версия orders |
| Reservations | UNIQUE(reservationId), UNIQUE(orderId), один активный владелец event_seat, частичный уникальный индекс резерва на (eventId, seatId) для HELD / CONFIRMED |
| Payments | UNIQUE(paymentId), UNIQUE(orderId), UNIQUE(providerOperationKey), UNIQUE(callbackId) |
| Все сервисы | Неизменяемая связь resourceId → owner / исходное тело; outbox.messageId уникален; отменённые ID не переиспользуются |

Непосредственно после захвата блокировки Reservations читает текущее время БД (`clock_timestamp()` в PostgreSQL), а не время начала транзакции, которое могло устареть в ожидании блокировки. Состояние места, резерва и outbox меняется в одной транзакции.

## Совместимость и проверка

Каналы заканчиваются на `.v1`. Изменение обязательных полей или смысла факта требует `.v2`; новый необязательный атрибут требует согласованного обновления схем и потребителей. Схемы MVP строгие (`additionalProperties: false`): неизвестные поля не считаются автоматически совместимыми.

`npm run docs:check` проверяет OpenAPI, AsyncAPI, примеры событий, локальные ссылки и синхронизацию Mermaid с исходниками. `npm run docs:render` пересоздаёт SVG и обновляет блоки Mermaid. Документация не подменяет будущие интеграционные проверки второго этапа.
