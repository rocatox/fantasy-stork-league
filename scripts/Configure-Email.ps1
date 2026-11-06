$ErrorActionPreference = 'Stop'
$appRoot = Split-Path $PSScriptRoot -Parent
$nodePath = Join-Path $appRoot '../../work/node-x64/node-v22.16.0-win-x64/node.exe'
$wranglerPath = Join-Path $appRoot 'node_modules/wrangler/bin/wrangler.js'
Push-Location $appRoot
try {
  $identity = (& $nodePath $wranglerPath whoami 2>&1 | Out-String)
  if ($LASTEXITCODE -ne 0 -or -not $identity.Contains('447b544d13b82f790d35ee40cf9374fd')) {
    & $nodePath $wranglerPath login
    if ($LASTEXITCODE -ne 0) { throw 'Cloudflare login did not complete.' }
    $identity = (& $nodePath $wranglerPath whoami 2>&1 | Out-String)
    if (-not $identity.Contains('447b544d13b82f790d35ee40cf9374fd')) { throw 'Expected Cloudflare account is unavailable.' }
  }
  Write-Host 'First verify notify.storkleague.fans in Resend. Use a Sending access key restricted to that domain.'
  $secureValue = Read-Host 'Resend API key (hidden)' -AsSecureString
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureValue)
  try {
    $key = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr).Trim()
    if ($key -notmatch '^re_[A-Za-z0-9_-]+$') { throw 'Enter only the complete Resend key, without quotes. No value was printed.' }
    $values = @{RESEND_API_KEY=$key;EMAIL_FROM='updates@notify.storkleague.fans';EMAIL_ENABLED='true'}
    $encoded = $values | ConvertTo-Json -Compress
    $result = $encoded | & $nodePath (Join-Path $PSScriptRoot 'Validate-Email.mjs')
    $check = $result | ConvertFrom-Json
    if (-not $check.ok) { Write-Host ('Safe diagnostic: '+$result); throw 'Resend validation failed. Check domain verification and key permissions. No Cloudflare secrets changed.' }
    $encoded | & $nodePath $wranglerPath secret bulk
    if ($LASTEXITCODE -ne 0) { throw 'Cloudflare secret installation did not complete. Run this helper again.' }
    Write-Host 'Email sending configured. No credential values were printed. Tell Codex setup succeeded.'
  } finally {
    $key=$null;$encoded=$null;if($values){$values.Clear()}
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr);$secureValue.Dispose()
  }
} finally { Pop-Location }
