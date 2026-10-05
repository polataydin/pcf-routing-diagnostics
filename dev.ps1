npm.cmd run build
if ($LASTEXITCODE -ne 0) { exit 1 }

$src = ".\out\controls\net462\RoutingDiagnostics\bundle.js"
$targets = Get-ChildItem C:\pcf-override -Recurse -Filter bundle.js |
           Where-Object { $_.FullName -like '*cc_PLT.RoutingDiagnostics*' }

if (-not $targets) { Write-Host "Override dosyasi bulunamadi"; exit 1 }

foreach ($t in $targets) {
  Copy-Item $src $t.FullName -Force
  Write-Host "Yazildi: $($t.FullName)"
}