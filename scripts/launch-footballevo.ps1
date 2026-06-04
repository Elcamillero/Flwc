$jarPath = "D:\DESCARGAS\footballevo.jar"

if (-not (Test-Path $jarPath)) {
  Write-Error "FootballEvo jar not found at $jarPath"
  exit 1
}

Start-Process -FilePath java -ArgumentList "-jar", $jarPath
