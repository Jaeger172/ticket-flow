# 5. Архитектурные решения

Статус всех ADR: **принято для архитектуры MVP**. Решения можно пересмотреть во второй части отдельным ADR; старый документ сохраняется со ссылкой на замену.

| ADR | Решение | Какую проблему решает |
|---|---|---|
| [001](adr/001-service-boundaries.md) | Три бизнес-контекста и собственные базы | Независимые инварианты и владение данными |
| [002](adr/002-saga-orchestration.md) | Сохранённая Saga в Orders; HTTP-команды и события | Восстановление распределённой покупки |
| [003](adr/003-reliable-delivery.md) | Outbox, inbox и at-least-once | Потери и повторная доставка сообщений |
| [004](adr/004-seat-reservation.md) | Временный резерв и атомарное подтверждение | Двойная продажа и гонка со сроком |
| [005](adr/005-payments-and-idempotency.md) | Стабильные ID, сверка и монотонная отмена | Неизвестный платёж, позднее списание, повтор возврата |

## Основания и спецификации

- [C4: Container diagram](https://c4model.com/diagrams/container) — область и элементы схемы уровня Container.
- [OpenAPI 3.0.3](https://spec.openapis.org/oas/v3.0.3) — формат HTTP-контрактов. Версия выбрана для совместимости инструментов, это не заявление о последней версии стандарта.
- [AsyncAPI 2.6.0](https://github.com/asyncapi/spec/blob/v2.6.0/spec/asyncapi.md) — формат событий; направления publish / subscribe трактуются с позиции приложения Orders.
- [Saga](https://microservices.io/patterns/data/saga.html) — локальные транзакции и компенсации.
- [Transactional Outbox](https://microservices.io/patterns/data/transactional-outbox.html) — сохранение исходящего сообщения с бизнес-изменением.
- [RabbitMQ: acknowledgements and publisher confirms](https://www.rabbitmq.com/docs/confirms) — подтверждения публикации и обработки.

Проектные сроки, статусы и поля контрактов — решения Ticket Flow, а не требования перечисленных источников.
