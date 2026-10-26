# V1 regression manifest

Сравнивается при V2 off, on и process-down:

- V1 agent остаётся на 9000 и использует прежние routes/session store/prompts;
- DMB `/api/v1/*`, auth, task/request/review lifecycle и основная DB не меняют
  контракт из-за V2;
- стандартный запуск без `-IncludeAssistantV2` не создаёт V2 process и не
  регистрирует V2 routes;
- frontend bundle `frontend/js/assistant-v2/*` не импортируется до успешного
  feature bootstrap и pilot gate;
- DMB readiness не падает только из-за V2;
- защищённые users, credentials, roles, role assignments, teams, ownership и
  dictionaries не создаются и не изменяются тестами или launcher.

Минимальная evidence-команда: backend pytest, frontend Node tests, Assistant V2
pytest, syntax checks, migration upgrade/head и smoke HTTP для трёх режимов.
