# Переработка страницы проекта — 04.11.2026

Повторная приёмка после аудита 18 недостатков. Предыдущий отчёт D01–D27
фиксирует прежнюю реализацию и не является визуальной приёмкой этого изменения.

## Реализация

| Замечания аудита | Изменение |
|---|---|
| 1, 2, 9, 10 | Компактная панель периода; на телефоне раскрытие по запросу. Фильтры плана свёрнуты, легенда под графиком, паспорт после основных данных. |
| 3 | После входа router.init открывает сохранённую ссылку; убран конкурирующий переход на dashboard. |
| 4, 11 | Общие Field, Button, KPI, SectionCard и DataTable; одинаковая плотность таблиц плана и результатов. |
| 5, 6 | Ширина года и квартала ограничена; расширенные фильтры собраны в адаптивную сетку. |
| 7, 8 | Короткие подписи KPI без стрелок и повторов периода; незаданные вехи отличаются от нулевого выполнения. |
| 12 | Расширена колонка названия; длинный статус представлен переносимым текстом вместо обрезаемого чипса. |
| 13 | Описание проекта постоянно присутствует под названием. |
| 14 | Легенда свёрнута; вехи, выполнение, внимание и исходный план поясняются при наличии соответствующих данных. |
| 15 | «Показывать задачи» и «Тип задач» вместо близких по смыслу названий. |
| 16 | Реальная причина сохранена, повторяющаяся заглушка заменена прямым переходом в задачу/результат. |
| 17 | Состав проекта — раскрываемый блок над рабочей областью, без постоянной второй боковой панели. |
| 18 | Заголовок «Рабочие задачи проекта» не обещает выдачу всех статусов; выбранный статус и действие снятия ограничения сохраняются. |

## UI Kit

Размеры контролов, семантические цвета, типографические токены, таблицы и карточки
принадлежат общим компонентам. Локальный CSS отвечает за компоновку и предметный
Гант. Удалены переопределения переноса внутри Badge: полный длинный статус теперь
обычный текст. Стиль проекта подключён явно после рабочих страниц, до UI Kit,
чтобы предметная компоновка не зависела от раннего CSS import.

## Проверка

Функциональность: пройдены 42 сценария проекта и рабочих страниц. После последних
правок — ещё 9 проверок маршрутизатора и компоновки (6 новых сценариев ширина × тема).
Команда: `npx playwright test --config=playwright.projects.config.mjs`;
финальная целевая проверка: `... projectVisualAcceptance projectDesignReview`.
Проверки API сохранения и конфликтов выполняются на изолированных fixture.

Live: встроенный браузер, проект IB, QA ba-a, 4 квартал 2026. Desktop около
1440 px; мобильные viewport 320 и 390 px (ширина проверялась по DOM).
Осмотрены обзор, план, Гант, отклонения, результаты и рабочие задачи; светлая
и тёмная темы. Проверены повторный вход с возвратом на Гант, переходы разделов,
поиск без совпадений и сброс, раскрытие фильтров, показ всех рабочих задач,
прокрутка карточек. Защищённые данные не менялись.

Визуальная оценка: принята для перечисленных экранов и данных. В обзоре на desktop
видны все три отклонения; в Ганте видны обе полосы без прокрутки служебных настроек.
На телефоне период и фильтры доступны по раскрытию, статус читается полностью,
при прокрутке остаётся только селектор раздела. Выявленные в ходе проверки
обрезание статуса и чрезмерная закреплённая шапка исправлены до приёмки.

UI Kit: Field/Button/KPI/SectionCard/DataTable сохраняют общие контракты.
Композиция и Гант — предметная ответственность страницы. Перенос обычного
статуса не изменяет однострочный контракт Badge. Светлые/тёмные поверхности
проверены визуально, горизонтального переполнения документа на мобильных нет.

Границы: это приёмка страницы проекта, а не всей системы. Live-проверка выполнена
под ролью просмотра; редактирование и конфликт версии проверены fixture.
Zoom 200%, forced colors и экранный диктор в эту итерацию не входили.


## Доказательства

- [320-dark-deviations](evidence/project-redesign-2026-11-04/320-dark-deviations.png)
- [320-dark-plan](evidence/project-redesign-2026-11-04/320-dark-plan.png)
- [320-light-deviations](evidence/project-redesign-2026-11-04/320-light-deviations.png)
- [320-light-execution](evidence/project-redesign-2026-11-04/320-light-execution.png)
- [320-light-plan](evidence/project-redesign-2026-11-04/320-light-plan.png)
- [desktop-dark-about](evidence/project-redesign-2026-11-04/desktop-dark-about.png)
- [desktop-dark-execution](evidence/project-redesign-2026-11-04/desktop-dark-execution.png)
- [desktop-dark-gantt](evidence/project-redesign-2026-11-04/desktop-dark-gantt.png)
- [desktop-dark-plan](evidence/project-redesign-2026-11-04/desktop-dark-plan.png)
- [desktop-dark-results](evidence/project-redesign-2026-11-04/desktop-dark-results.png)
- [desktop-light-about](evidence/project-redesign-2026-11-04/desktop-light-about.png)
- [desktop-light-deviations](evidence/project-redesign-2026-11-04/desktop-light-deviations.png)
- [desktop-light-execution](evidence/project-redesign-2026-11-04/desktop-light-execution.png)
- [desktop-light-gantt](evidence/project-redesign-2026-11-04/desktop-light-gantt.png)
- [desktop-light-plan](evidence/project-redesign-2026-11-04/desktop-light-plan.png)
- [desktop-light-results](evidence/project-redesign-2026-11-04/desktop-light-results.png)
- [mobile-dark-about](evidence/project-redesign-2026-11-04/mobile-dark-about.png)
- [mobile-dark-execution](evidence/project-redesign-2026-11-04/mobile-dark-execution.png)
- [mobile-dark-gantt](evidence/project-redesign-2026-11-04/mobile-dark-gantt.png)
- [mobile-dark-results](evidence/project-redesign-2026-11-04/mobile-dark-results.png)
- [mobile-dark-scrolled](evidence/project-redesign-2026-11-04/mobile-dark-scrolled.png)
- [mobile-light-about](evidence/project-redesign-2026-11-04/mobile-light-about.png)
- [mobile-light-gantt](evidence/project-redesign-2026-11-04/mobile-light-gantt.png)
- [mobile-light-results](evidence/project-redesign-2026-11-04/mobile-light-results.png)
