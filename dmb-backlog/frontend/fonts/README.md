# Комплектные шрифты

Проверено 19.10.2026. Шрифты раздаются приложением локально; внешние CDN не используются.

- Inter Variable — основной интерфейс, веса 400/500/600/700; [лицензия](LICENSE-Inter.txt).
- JetBrains Mono Variable 2.304 — ID и код, normal 100–800; [лицензия](LICENSE-JetBrainsMono.txt).
  Источник: [официальный выпуск JetBrains](https://github.com/JetBrains/JetBrainsMono/tree/v2.304/fonts/variable).
  Комплектный файл `JetBrainsMono-Variable.ttf` соответствует `JetBrainsMono[wght].ttf` из этого выпуска.
- Unbounded — отдельная роль числовых KPI; [лицензия](LICENSE-Unbounded.txt).

Семейства объявлены в `../css/fonts.css`, роли — в `../css/tokens.css`.
Для ID и кода применяется `var(--font-mono)`: JetBrains Mono, затем аварийный
системный monospace. Fira Code и Consolas не являются штатными зависимостями.
Служебные пустые состояния используют прямое начертание.
