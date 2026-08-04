# DMB Backlog - Команды запуска

## Запуск сервера (Windows)
```powershell
cd D:\Проект\dmb-backlog\backend
python -m uvicorn main:app --host 0.0.0.0 --port 8000
```

## Или через Python напрямую
```powershell
cd D:\Проект\dmb-backlog\backend
python -c "import uvicorn; uvicorn.run('main:app', host='0.0.0.0', port=8000)"
```

## Остановка сервера
```powershell
Get-Process -Name python | Where-Object { $_.CommandLine -like "*uvicorn*" } | Stop-Process -Force
```

## Открыть в браузере
```
http://localhost:8000
```
