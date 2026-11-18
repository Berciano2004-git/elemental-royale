<#
  Elemental Royale · túnel temporal
  Levanta el servidor en modo producción y un túnel de Cloudflare sin cuenta,
  espera a que el enlace responda por internet e imprime la URL con el código
  de sala, lista para pasar.

  Uso:
    npm run build
    powershell -ExecutionPolicy Bypass -File .\scripts\tunel.ps1
    powershell -ExecutionPolicy Bypass -File .\scripts\tunel.ps1 -Sala FIESTA -Puerto 8093
    powershell -ExecutionPolicy Bypass -File .\scripts\tunel.ps1 -SoloProbar

  -SoloProbar levanta, comprueba y cierra: sirve para verificar el propio script.
  La URL dura mientras esta ventana siga abierta y cambia en cada arranque.
#>
param(
  [int]$Puerto = 8093,
  [string]$Sala = 'AMIGOS',
  [switch]$SoloProbar
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
# Sin esto, Windows PowerShell 5.1 escribe en la página de códigos OEM y los
# acentos y símbolos salen rotos en terminales modernas.
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch { }

$raiz = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $raiz
$carpeta = Join-Path $raiz 'tmp-tunnel'
if (-not (Test-Path $carpeta)) { New-Item -ItemType Directory -Path $carpeta | Out-Null }

$exe = Join-Path $carpeta 'cloudflared.exe'
$destino = "http://127.0.0.1:$Puerto"
$codigo = ($Sala.ToUpper() -replace '[^A-Z0-9]', '')
if ([string]::IsNullOrEmpty($codigo)) { $codigo = 'AMIGOS' }
if ($codigo.Length -gt 6) { $codigo = $codigo.Substring(0, 6) }

$servidor = $null
$tunel = $null

function Detener {
  if ($tunel -and -not $tunel.HasExited) {
    Stop-Process -Id $tunel.Id -Force -ErrorAction SilentlyContinue
  }
  if ($servidor -and -not $servidor.HasExited) {
    Stop-Process -Id $servidor.Id -Force -ErrorAction SilentlyContinue
  }
}

function Test-Salud([string]$base, [int]$segundos) {
  $limite = (Get-Date).AddSeconds($segundos)
  while ((Get-Date) -lt $limite) {
    try {
      $r = Invoke-WebRequest -Uri "$base/healthz" -UseBasicParsing -TimeoutSec 15
      if ($r.StatusCode -eq 200) { return $true }
    } catch {
      # 530 mientras Cloudflare propaga el nombre nuevo; se reintenta.
    }
    Start-Sleep -Seconds 4
  }
  return $false
}

try {
  Write-Host ''
  Write-Host '  ✦ ELEMENTAL ROYALE · túnel temporal ✦' -ForegroundColor Cyan
  Write-Host ''

  # --- 1. Cliente compilado -------------------------------------------------
  # Siempre, no solo cuando falta dist/: un dist/ viejo serviría un cliente
  # desactualizado a quien entre por el túnel.
  Write-Host '  Compilando el cliente...' -ForegroundColor DarkGray
  & npm run build
  if ($LASTEXITCODE -ne 0) { throw 'La compilación ha fallado: revisa npm run build.' }

  # --- 2. cloudflared ------------------------------------------------------
  if (-not (Test-Path $exe)) {
    Write-Host '  Descargando cloudflared (una sola vez, ~53 MB)...' -ForegroundColor DarkGray
    $urlDescarga = 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe'
    Invoke-WebRequest -Uri $urlDescarga -OutFile $exe -UseBasicParsing
  }

  # --- 3. Servidor en modo producción -------------------------------------
  $yaCorre = $false
  try {
    $r = Invoke-WebRequest -Uri "$destino/healthz" -UseBasicParsing -TimeoutSec 3
    $yaCorre = $r.StatusCode -eq 200
  } catch {
    $yaCorre = $false
  }

  if ($yaCorre) {
    Write-Host "  Ya hay un servidor respondiendo en ${destino}: lo reutilizo." -ForegroundColor DarkGray
  } else {
    $env:PORT = "$Puerto"
    $env:NODE_ENV = 'production'
    $servidor = Start-Process -FilePath 'node' `
      -ArgumentList @('server/index.js', '--prod') `
      -PassThru -NoNewWindow `
      -RedirectStandardOutput (Join-Path $carpeta 'servidor.log') `
      -RedirectStandardError (Join-Path $carpeta 'servidor.err.log')
    if (-not (Test-Salud $destino 25)) {
      throw "El servidor no responde en ${destino}. Mira tmp-tunnel\servidor.err.log (¿puerto ocupado?)."
    }
    Write-Host "  Servidor escuchando en $destino (PID $($servidor.Id))." -ForegroundColor Green
  }

  # --- 4. Túnel ------------------------------------------------------------
  $logTunel = Join-Path $carpeta 'tunnel.log'
  $errTunel = Join-Path $carpeta 'tunnel.log.err'
  Remove-Item $logTunel, $errTunel -ErrorAction SilentlyContinue

  $tunel = Start-Process -FilePath $exe `
    -ArgumentList @('tunnel', '--url', $destino) `
    -PassThru -NoNewWindow `
    -RedirectStandardOutput $logTunel `
    -RedirectStandardError $errTunel

  $url = $null
  $limite = (Get-Date).AddSeconds(60)
  while ((Get-Date) -lt $limite) {
    Start-Sleep -Seconds 2
    foreach ($archivo in @($errTunel, $logTunel)) {
      if (Test-Path $archivo) {
        $texto = Get-Content $archivo -Raw -ErrorAction SilentlyContinue
        if ($texto -match 'https://[a-z0-9-]+\.trycloudflare\.com') {
          $url = $Matches[0]
          break
        }
      }
    }
    if ($url) { break }
    if ($tunel.HasExited) { throw "El túnel se ha cerrado solo. Mira ${errTunel}." }
  }
  if (-not $url) { throw "Cloudflare no ha dado una URL en un minuto. Mira ${errTunel}." }

  Write-Host "  Túnel abierto: ${url}" -ForegroundColor Green
  Write-Host '  Esperando a que el enlace responda por internet (la primera vez tarda hasta un minuto)...' -ForegroundColor DarkGray

  if (-not (Test-Salud $url 150)) {
    throw 'El enlace no responde todavía. Suele ser propagación de Cloudflare: espera un poco y abre la URL igualmente.'
  }

  Write-Host ''
  Write-Host '  Enlace para pasar:' -ForegroundColor Cyan
  Write-Host "  ${url}/?sala=${codigo}" -ForegroundColor Green
  Write-Host ''
  Write-Host "  Sala: $codigo · también pueden escribir el código en el lobby." -ForegroundColor DarkGray
  Write-Host '  Dura solo mientras esta ventana siga abierta: si la cierras, apagas el PC' -ForegroundColor Yellow
  Write-Host '  o entra en suspensión, el enlace muere y al volver a arrancar será otro.' -ForegroundColor Yellow
  Write-Host '  Ctrl+C para cerrarlo.' -ForegroundColor Yellow
  Write-Host ''

  if ($SoloProbar) {
    Write-Host '  Modo prueba: todo responde, cierro servidor y túnel.' -ForegroundColor DarkGray
    return
  }

  while ($true) {
    Start-Sleep -Seconds 3
    if ($tunel.HasExited) {
      Write-Host '  El túnel se ha cerrado. Vuelve a ejecutar el script para tener uno nuevo.' -ForegroundColor Red
      break
    }
    if ($servidor -and $servidor.HasExited) {
      Write-Host '  El servidor se ha cerrado. Vuelve a ejecutar el script.' -ForegroundColor Red
      break
    }
  }
} finally {
  Detener
  if ($SoloProbar -and $tunel) {
    Write-Host '  Cerrado.' -ForegroundColor DarkGray
  }
}
