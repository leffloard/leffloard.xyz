@echo off

:: Backend'i yeni pencerede aç
cd /d C:\Users\Leff\Desktop\leffloard.xyz\backend
start "" cmd /k "python -m uvicorn server:app --reload"

:: Frontend'i çalıştır
cd /d C:\Users\Leff\Desktop\leffloard.xyz\frontend
npm run dev
