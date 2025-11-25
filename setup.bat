@echo off
echo ===================================
echo Configurando Cortes de Video
echo ===================================
echo.

echo [1/4] Instalando dependencias Node.js...
call npm install
if %ERRORLEVEL% NEQ 0 (
    echo Erro ao instalar dependencias!
    pause
    exit /b 1
)
echo.

echo [2/4] Verificando yt-dlp...
where yt-dlp >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    if not exist yt-dlp.exe (
        echo Baixando yt-dlp...
        curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe -o yt-dlp.exe
        if %ERRORLEVEL% NEQ 0 (
            echo Erro ao baixar yt-dlp!
            pause
            exit /b 1
        )
    ) else (
        echo yt-dlp local encontrado!
    )
) else (
    echo yt-dlp encontrado no PATH!
)
echo.

echo [3/4] Verificando FFmpeg...
if not exist ffmpeg-bin\bin\ffmpeg.exe (
    echo Baixando FFmpeg...
    curl -L https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip -o ffmpeg.zip
    if %ERRORLEVEL% NEQ 0 (
        echo Erro ao baixar FFmpeg!
        pause
        exit /b 1
    )

    echo Extraindo FFmpeg...
    tar -xf ffmpeg.zip
    ren ffmpeg-master-latest-win64-gpl ffmpeg-bin
    del ffmpeg.zip
) else (
    echo FFmpeg local encontrado!
)
echo.

echo [4/4] Verificando estrutura de diretorios...
if not exist downloads mkdir downloads
if not exist temp mkdir temp
echo.

echo ===================================
echo Configuracao concluida com sucesso!
echo ===================================
echo.
echo Para iniciar o servidor, execute:
echo   npm start
echo.
pause
