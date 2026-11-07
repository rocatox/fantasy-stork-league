$ErrorActionPreference = 'Stop'
$appRoot = Split-Path $PSScriptRoot -Parent
$nodePath = Join-Path $appRoot '../../work/node-x64/node-v22.16.0-win-x64/node.exe'
$wranglerPath = Join-Path $appRoot 'node_modules/wrangler/bin/wrangler.js'
Push-Location $appRoot
try {
  $identity = (& $nodePath $wranglerPath whoami 2>&1 | Out-String)
  if ($LASTEXITCODE -ne 0 -or -not $identity.Contains('447b544d13b82f790d35ee40cf9374fd')) {
    throw 'Cloudflare login needs refreshing. Run the existing Wrangler login before retrying. No secrets changed.'
  }
  Write-Host 'This validates Brevo, registers our sender if needed, and sends ONE synthetic test to your chosen inbox.'
  Write-Host 'It installs only BREVO_API_KEY. Existing notification settings are unchanged.'
  $testInbox = (Read-Host 'Your own email address for the test').Trim()
  $secureValue = Read-Host 'Brevo API key (hidden; not an SMTP key)' -AsSecureString
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureValue)
  try {
    $key = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr).Trim()
    $inputValues = @{key=$key;to=$testInbox}
    $encoded = $inputValues | ConvertTo-Json -Compress
    $result = $encoded | & $nodePath (Join-Path $PSScriptRoot 'Validate-Brevo.mjs')
    $validationExit = $LASTEXITCODE
    $check = $result | ConvertFrom-Json
    if ($validationExit -ne 0 -or -not $check.ok) {
      Write-Host ('Safe diagnostic: '+$result)
      throw 'Brevo validation failed. No Cloudflare secrets changed. Share only the safe diagnostic with Codex.'
    }
    Write-Host ('Test accepted by Brevo. Message reference: '+$check.messageId)
    $values = @{BREVO_API_KEY=$key}
    $secretJson = $values | ConvertTo-Json -Compress
    $secretJson | & $nodePath $wranglerPath secret bulk
    if ($LASTEXITCODE -ne 0) { throw 'Test was accepted, but secret installation failed. Tell Codex before rerunning to avoid another test email.' }
    Write-Host 'Brevo key installed; Brevo is the production provider. Check your inbox/spam and report whether the test arrived and its link works.'
    Write-Host 'No credential values were printed. This helper does not switch providers or remove batching.'
  } finally {
    $key=$null;$encoded=$null;$secretJson=$null
    if($inputValues){$inputValues.Clear()};if($values){$values.Clear()}
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr);$secureValue.Dispose()
  }
} finally { Pop-Location }
