# One-shot Supabase deploy: .\deploy.ps1
# Reads .env, links the project, pushes migrations, sets function secrets, deploys functions.
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if (-not (Test-Path ".env")) {
  Write-Error "No .env found. Copy .env.example to .env and fill it in."
}

$cfg = @{}
Get-Content .env | ForEach-Object {
  $line = ($_ -split '#')[0].Trim()
  if ($line -match '^([A-Z_]+)=(.*)$') { $cfg[$Matches[1]] = $Matches[2].Trim() }
}

foreach ($k in "SUPABASE_PROJECT_REF","SUPABASE_ACCESS_TOKEN","WEBHOOK_SECRET") {
  if (-not $cfg[$k]) { Write-Error "$k is empty in .env" }
}
if (-not $cfg["GEMINI_API_KEY"] -and -not $cfg["ANTHROPIC_API_KEY"] -and -not $cfg["AI_GATEWAY_API_KEY"]) {
  Write-Error "Set GEMINI_API_KEY, ANTHROPIC_API_KEY, or AI_GATEWAY_API_KEY in .env"
}

$env:SUPABASE_ACCESS_TOKEN = $cfg["SUPABASE_ACCESS_TOKEN"]
$ref = $cfg["SUPABASE_PROJECT_REF"]

Write-Host "`n== link project $ref" -ForegroundColor Cyan
npx --yes supabase link --project-ref $ref

Write-Host "`n== db push (migrations)" -ForegroundColor Cyan
npx --yes supabase db push

Write-Host "`n== secrets" -ForegroundColor Cyan
$names = "GEMINI_API_KEY","GEMINI_MODEL","ANTHROPIC_API_KEY","AI_GATEWAY_API_KEY","CLAUDE_API_URL","CLAUDE_MODEL","WEBHOOK_SECRET","WAHA_URL","WAHA_API_KEY","WAHA_SESSION",
         "BOT_PHONE","BOT_LID","BOT_CODE_WORD","BOT_MENTION_NAMES","POST_TO_GROUP","MIN_MESSAGES","LOG_RAW_EVENTS"
$secrets = $names | Where-Object { $cfg[$_] } | ForEach-Object { "$_=$($cfg[$_])" }
npx --yes supabase secrets set @secrets

Write-Host "`n== deploy functions" -ForegroundColor Cyan
npx --yes supabase functions deploy wa-webhook --no-verify-jwt
npx --yes supabase functions deploy wa-daily-summary

Write-Host "`nDone." -ForegroundColor Green
Write-Host "Webhook URL for WAHA: https://$ref.supabase.co/functions/v1/wa-webhook?secret=$($cfg['WEBHOOK_SECRET'])"
Write-Host "Schedule (once, SQL Editor): select wa_schedule_daily_summary('$ref', '<SERVICE_ROLE_KEY>');"
