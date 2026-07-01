# Nova VPS .env kurucu — anahtarları .env.local'dan okur, VPS'e yazar.
$ErrorActionPreference = "Stop"
$src = "C:\Users\info\Projeler\nova\.env.local"

$ant = (Select-String -Path $src -Pattern '^ANTHROPIC_API_KEY=' | Select-Object -First 1).Line
$gh  = (Select-String -Path $src -Pattern '^GITHUB_TOKEN='     | Select-Object -First 1).Line

if (-not $ant) { Write-Host "HATA: ANTHROPIC_API_KEY .env.local'da yok"; exit 1 }
if (-not $gh)  { Write-Host "HATA: GITHUB_TOKEN .env.local'da yok"; exit 1 }

$pass = Read-Host "Nova giris sifresi belirle (kullanici adi: nova)"
if (-not $pass) { Write-Host "Sifre bos olamaz"; exit 1 }

$body = "$ant`n$gh`nNOVA_MODEL=claude-opus-4-8`nNOVA_USER=nova`nNOVA_PASS=$pass`n"

Write-Host "VPS'e yaziliyor..."
$body | ssh -i "C:\Users\info\.ssh\nova_vps" -o StrictHostKeyChecking=accept-new root@76.13.249.73 "cat > /root/nova.env && echo HAZIR"

Write-Host "`nBitti. Yukarida HAZIR gorunduyse tamam."
