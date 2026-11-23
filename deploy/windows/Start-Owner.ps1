param([switch]$ShareClass)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
if (!(Get-Command node.exe -ErrorAction SilentlyContinue)) {
    throw 'Install Node.js 24 LTS from https://nodejs.org/ and reopen Start-Owner.cmd.'
}
& node -e 'if(Number(process.versions.node.split(".")[0]) < 24) process.exit(1)'
if ($LASTEXITCODE -ne 0) { throw 'Node.js 24 or newer is required.' }
$env:SCHOOL_HOST = '127.0.0.1'
$env:SCHOOL_SECURE = '0'
$env:SCHOOL_DB = Join-Path $PSScriptRoot 'data\school.sqlite'
$env:ADMIN_PORT = '3001'
$env:STUDENT_PORT = '3000'
$env:OWNER_USERNAME = 'owner'
Remove-Item Env:OWNER_TOTP_HEX -ErrorAction SilentlyContinue
Remove-Item Env:ADMIN_ORIGIN -ErrorAction SilentlyContinue
Remove-Item Env:STUDENT_ORIGIN -ErrorAction SilentlyContinue
if (!(Test-Path -LiteralPath $env:SCHOOL_DB)) {
    $secret = Read-Host 'Create your owner password (12 to 128 characters)' -AsSecureString
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
    try { $env:OWNER_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
    if ($secret.Length -lt 12 -or $secret.Length -gt 128) { throw 'Use 12 to 128 characters.' }
}
$env:SCHOOL_WASM_OCR = Join-Path $PSScriptRoot 'ocr'
if ($ShareClass) {
    $tailscale = Get-Command tailscale.exe -ErrorAction SilentlyContinue
    if (!$tailscale) { throw 'Install Tailscale from https://tailscale.com/download/windows and sign in, then reopen Share-Class.cmd.' }
    $state = (& $tailscale.Source status --json | ConvertFrom-Json)
    if ($state.BackendState -ne 'Running') { throw 'Sign in to Tailscale on this computer first.' }
    $schoolHost = $state.Self.DNSName.TrimEnd('.')
    if (!$schoolHost) { throw 'Enable MagicDNS in Tailscale first.' }
    $env:STUDENT_ORIGIN = "https://${schoolHost}:8443"
    Write-Host "Student class address: $env:STUDENT_ORIGIN"
    Write-Host 'If requested by Tailscale, open the approval URL to enable Funnel.'
    $tunnel = Start-Process -FilePath $tailscale.Source -ArgumentList 'funnel','--https=8443','http://127.0.0.1:3000' -PassThru -NoNewWindow
}
try {
    Write-Host 'Owner dashboard: http://localhost:3001'
    Write-Host 'Login name: owner'
    Write-Host 'Keep this window open while using the dashboard.'
    & node server.mjs
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
    if ($tunnel -and !$tunnel.HasExited) { $tunnel.Kill() }
    Remove-Item Env:OWNER_PASSWORD -ErrorAction SilentlyContinue
}
