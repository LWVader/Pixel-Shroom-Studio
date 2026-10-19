@echo off
cd /d "%~dp0"
echo Pixel Shroom Studio local visual demo
echo Run npm.cmd ci first if dependencies are not installed.
echo Wait for the Open URL message, then open http://127.0.0.1:8030
echo Keep this window open while browsing. Ctrl+C stops the demo.
call npm.cmd run demo
pause
