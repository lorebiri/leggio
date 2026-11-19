# Prova dell'assistente IA di Leggio su questo PC (Windows 10/11, PowerShell 5.1).
# Misura: processore (AVX2), RAM, tempi di caricamento, velocità, RAM usata, risposte su 4 documenti pubblici.
# Non invia nulla a nessuno: l'unica connessione è il download dei modelli (da Hugging Face, con verifica SHA-256).
# Alla fine scrive un file di risultati sul Desktop da rimandare.
#
# Uso normale: doppio clic su AVVIA-PROVA.bat
# Opzioni (per chi sa usarle): -Breve (modello piccolissimo e 2 documenti: solo per il controllo automatico)
#                              -SoloGemma (non scarica il secondo modello)
param([switch]$Breve, [switch]$SoloGemma)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$Qui = Split-Path -Parent $MyInvocation.MyCommand.Path
$Inizio = Get-Date
$Versione = '1'

function Scrivi($testo, $colore = 'White') { Write-Host $testo -ForegroundColor $colore }
function Titolo($testo) { Write-Host ''; Write-Host "== $testo ==" -ForegroundColor Cyan }

# I file arrivano da internet (zip scaricato): Windows li segna come "bloccati". Li sblocchiamo.
try { Get-ChildItem -Path $Qui -Recurse -File | Unblock-File } catch { }

$Llama = Join-Path $Qui 'llama'
$Modelli = Join-Path $Qui 'modelli'
New-Item -ItemType Directory -Force -Path $Modelli | Out-Null
$Log = Join-Path $Qui 'registro-prova.txt'
"Prova IA Leggio - $Inizio" | Out-File -FilePath $Log -Encoding UTF8

Scrivi ''
Scrivi '  PROVA DELL''ASSISTENTE IA DI LEGGIO' 'Yellow'
Scrivi '  La prova dura da 20 a 60 minuti (di più se deve scaricare i modelli).' 'Yellow'
Scrivi '  Durante la prova il PC sarà lento: è normale. Non chiudere questa finestra.' 'Yellow'

# ---------------------------------------------------------------- 1. il PC
Titolo '1. Controllo del computer'
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
$cs = Get-CimInstance Win32_ComputerSystem
$os = Get-CimInstance Win32_OperatingSystem
$ramTotGB = [math]::Round($cs.TotalPhysicalMemory / 1GB, 1)
$ramLiberaGB = [math]::Round($os.FreePhysicalMemory * 1KB / 1GB, 1)
$discoLiberoGB = $null
try { $discoLiberoGB = [math]::Round((Get-PSDrive -Name ($Qui.Substring(0, 1))).Free / 1GB, 1) } catch { }

Add-Type -Namespace Leggio -Name Cpu -MemberDefinition '[DllImport("kernel32.dll")] public static extern bool IsProcessorFeaturePresent(uint f);'
$avx2 = [Leggio.Cpu]::IsProcessorFeaturePresent(40)     # PF_AVX2_INSTRUCTIONS_AVAILABLE
$avx512 = [Leggio.Cpu]::IsProcessorFeaturePresent(41)   # PF_AVX512F_INSTRUCTIONS_AVAILABLE
$core = [int]$cpu.NumberOfCores
$thread = [math]::Max(1, [math]::Min(4, $core))

$sistema = [ordered]@{
  processore = $cpu.Name.Trim(); core = $core; processori_logici = [int]$cpu.NumberOfLogicalProcessors
  mhz_max = [int]$cpu.MaxClockSpeed; avx2 = $avx2; avx512 = $avx512
  ram_totale_gb = $ramTotGB; ram_libera_all_avvio_gb = $ramLiberaGB; disco_libero_gb = $discoLiberoGB
  windows = "$($os.Caption) $($os.Version)"; thread_usati = $thread
}
Scrivi ("  Processore:  {0} ({1} core)" -f $sistema.processore, $core)
Scrivi ("  AVX2:        {0}" -f $(if ($avx2) { 'sì' } else { 'NO' }))
Scrivi ("  RAM:         {0} GB in tutto, {1} GB libera ora" -f $ramTotGB, $ramLiberaGB)
Scrivi ("  Disco:       {0} GB liberi" -f $discoLiberoGB)

$Risultati = [ordered]@{ versione_kit = $Versione; data = $Inizio.ToString('s'); sistema = $sistema; modelli = @(); note = @() }

function Salva-Risultati {
  $Risultati.durata_minuti = [math]::Round(((Get-Date) - $Inizio).TotalMinutes, 1)
  $id = (Get-Random -Maximum 99999).ToString('00000')
  $desktop = [Environment]::GetFolderPath('Desktop')
  if (-not $desktop -or -not (Test-Path $desktop)) { $desktop = $Qui }
  $nome = "Risultati-prova-IA-{0}-{1}.txt" -f $Inizio.ToString('yyyyMMdd-HHmm'), $id
  $file = Join-Path $desktop $nome
  $righe = @()
  $righe += 'RISULTATI DELLA PROVA DELL''ASSISTENTE IA DI LEGGIO'
  $righe += 'Rimanda questo file così com''è. Non contiene documenti né dati personali.'
  $righe += ''
  $righe += ('Processore: {0} - {1} core - AVX2: {2}' -f $sistema.processore, $sistema.core, $sistema.avx2)
  $righe += ('RAM: {0} GB (libera all''avvio {1} GB) - Windows: {2}' -f $sistema.ram_totale_gb, $sistema.ram_libera_all_avvio_gb, $sistema.windows)
  foreach ($m in $Risultati.modelli) {
    $righe += ''
    $righe += ('Modello {0}: {1}' -f $m.nome, $m.esito)
    if ($m.lettura_tok_s) {
      $righe += ('  caricamento {0} s - lettura {1} token/s - scrittura {2} token/s - RAM usata {3} GB' -f $m.caricamento_s, $m.lettura_tok_s, $m.scrittura_tok_s, $m.ram_picco_gb)
      $righe += ('  risposte giuste {0} su {1} (con la pagina giusta {2})' -f $m.risposte_giuste, $m.domande, $m.pagine_giuste)
      foreach ($c in $m.compiti) { $righe += ('  - {0} / {1}: {2} s' -f $c.documento, $c.compito, $c.secondi) }
    }
  }
  foreach ($n in $Risultati.note) { $righe += ''; $righe += "Nota: $n" }
  $righe += ''
  $righe += '----- dati completi (per chi analizza) -----'
  $righe += ($Risultati | ConvertTo-Json -Depth 8)
  $righe | Out-File -FilePath $file -Encoding UTF8
  Copy-Item $file (Join-Path $Qui 'ultimi-risultati.txt') -Force
  return $file
}

if (-not $avx2) {
  $Risultati.note += 'Il processore non ha AVX2: l''assistente IA non è adatto a questo PC.'
  $f = Salva-Risultati
  Scrivi ''
  Scrivi '  Questo processore non ha AVX2: l''assistente IA non può funzionare bene qui.' 'Red'
  Scrivi "  Il risultato è comunque utile: rimanda il file $f" 'Yellow'
  exit 0
}

# ---------------------------------------------------------------- 2. i modelli
$elenco = @(
  [ordered]@{ nome = 'Gemma 4 E2B (principale)'; file = 'gemma-4-E2B-it-Q4_K_M.gguf'; byte = 3106738272
    sha = '740185b21d22ceb83a11c3aa62ad5842ef32c70f6096d756bbee85a1e4ec34b8'
    url = 'https://huggingface.co/unsloth/gemma-4-E2B-it-GGUF/resolve/0314792d7f1f7e229411f620751375812bb9faf2/gemma-4-E2B-it-Q4_K_M.gguf' },
  [ordered]@{ nome = 'Qwen3.5-2B (leggero)'; file = 'Qwen3.5-2B-Q4_K_M.gguf'; byte = 1280835840
    sha = 'aaf42c8b7c3cab2bf3d69c355048d4a0ee9973d48f16c731c0520ee914699223'
    url = 'https://huggingface.co/unsloth/Qwen3.5-2B-GGUF/resolve/f6d5376be1edb4d416d56da11e5397a961aca8ae/Qwen3.5-2B-Q4_K_M.gguf' }
)
if ($Breve) {
  $elenco = @([ordered]@{ nome = 'Qwen3.5-0.8B (solo controllo)'; file = 'Qwen3.5-0.8B-Q4_K_M.gguf'; byte = 532517120
    sha = 'bd258782e35f7f458f8aced1adc053e6e92e89bc735ba3be89d38a06121dc517'
    url = 'https://huggingface.co/unsloth/Qwen3.5-0.8B-GGUF/resolve/6ab461498e2023f6e3c1baea90a8f0fe38ab64d0/Qwen3.5-0.8B-Q4_K_M.gguf' })
} elseif ($SoloGemma) { $elenco = @($elenco[0]) }

function Prepara-Modello($m) {
  $dest = Join-Path $Modelli $m.file
  if ((Test-Path $dest) -and ((Get-Item $dest).Length -eq $m.byte)) {
    Scrivi "  $($m.nome): già presente, controllo l'impronta SHA-256..."
  } else {
    $gb = [math]::Round($m.byte / 1GB, 1)
    Scrivi "  $($m.nome): scarico $gb GB. Può richiedere da 5 a 40 minuti, a seconda della rete." 'Yellow'
    $part = "$dest.part"
    $ok = $false
    $curl = Join-Path $env:SystemRoot 'System32\curl.exe'
    if (Test-Path $curl) {
      # curl mostra l'avanzamento direttamente in questa finestra (stderr non rediretto)
      $vecchio = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
      & $curl -L --fail --retry 5 --retry-delay 5 -C - --progress-bar -o $part $m.url
      $ok = ($LASTEXITCODE -eq 0)
      $ErrorActionPreference = $vecchio
      "curl $($m.file): codice $LASTEXITCODE" | Out-File -Append -FilePath $Log -Encoding UTF8
    }
    if (-not $ok) {
      Scrivi '  Provo con il servizio di download di Windows (usa il proxy dell''ufficio)...'
      try {
        if (Test-Path $part) { Remove-Item $part -Force }
        Start-BitsTransfer -Source $m.url -Destination $part -DisplayName 'Prova IA Leggio' -ErrorAction Stop
        $ok = $true
      } catch { "BITS: $_" | Out-File -Append -FilePath $Log -Encoding UTF8 }
    }
    if (-not $ok) { return $false }
    Move-Item -Force $part $dest
    Scrivi '  Scaricato. Controllo l''impronta SHA-256...'
  }
  $h = (Get-FileHash -Algorithm SHA256 -Path $dest).Hash.ToLower()
  if ($h -ne $m.sha) {
    Remove-Item $dest -Force
    Scrivi '  ATTENZIONE: il file non corrisponde (impronta diversa). L''ho cancellato.' 'Red'
    return $false
  }
  Scrivi '  Impronta corretta.' 'Green'
  return $true
}

# ---------------------------------------------------------------- 3. le prove
$doc = (Get-Content -Raw -Encoding UTF8 -Path (Join-Path $Qui 'documenti.json') | ConvertFrom-Json).documenti
if ($Breve) { $doc = @($doc[0], $doc[1]) }
$Sistema = 'Sei l''assistente di un ufficio pubblico italiano. Lavori solo sul documento fornito: non aggiungere informazioni che non ci sono. Rispondi in italiano corretto.'
$schemaDomanda = @{ type = 'object'; properties = @{ risposta = @{ type = 'string' }; pagina = @{ type = @('integer', 'null') } }; required = @('risposta', 'pagina') }
$schemaDati = @{ type = 'object'; properties = @{ importo = @{ type = @('string', 'null') }; cig = @{ type = @('string', 'null') }; cup = @{ type = @('string', 'null') }; rup = @{ type = @('string', 'null') } }; required = @('importo', 'cig', 'cup', 'rup') }

function Normalizza($s) {
  if ($null -eq $s) { return '' }
  $t = ([string]$s).ToLower().Normalize([Text.NormalizationForm]::FormD)
  $t = -join ($t.ToCharArray() | Where-Object { [Globalization.CharUnicodeInfo]::GetUnicodeCategory($_) -ne 'NonSpacingMark' })
  return (($t -replace '[^a-z0-9,.]', ' ') -replace '\s+', ' ').Trim()
}

function Chiedi($porta, $testo, $compito, $max, $schema) {
  $corpo = @{
    messages = @(@{ role = 'system'; content = $Sistema }, @{ role = 'user'; content = "DOCUMENTO:`n$testo`n`n---`n$compito" })
    max_tokens = $max; temperature = 0; seed = 1; cache_prompt = $true
    chat_template_kwargs = @{ enable_thinking = $false }; reasoning_format = 'none'
  }
  if ($schema) { $corpo.response_format = @{ type = 'json_schema'; json_schema = @{ name = 'r'; schema = $schema } } }
  $json = $corpo | ConvertTo-Json -Depth 12 -Compress
  $t0 = Get-Date
  $r = Invoke-RestMethod -Uri "http://127.0.0.1:$porta/v1/chat/completions" -Method Post -TimeoutSec 3600 `
       -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($json))
  $sec = [math]::Round(((Get-Date) - $t0).TotalSeconds, 1)
  $out = [string]$r.choices[0].message.content
  return @{ testo = $out; secondi = $sec; timings = $r.timings }
}

function Prova-Modello($m) {
  $file = Join-Path $Modelli $m.file
  $esito = [ordered]@{ nome = $m.nome; file = $m.file; esito = 'ok'; compiti = @() }

  Scrivi "  Misura della velocità (llama-bench)..."
  $rip = if ($Breve) { '1' } else { '2' }
  $benchOut = Join-Path $Qui 'registro-bench.json'
  $pb = Start-Process -FilePath (Join-Path $Llama 'llama-bench.exe') -NoNewWindow -Wait -PassThru `
        -ArgumentList @('-m', "`"$file`"", '-t', $thread, '-p', '512', '-n', '64', '-r', $rip, '-o', 'json') `
        -RedirectStandardOutput $benchOut -RedirectStandardError (Join-Path $Qui 'registro-bench-err.txt')
  try {
    foreach ($b in (Get-Content -Raw -Path $benchOut | ConvertFrom-Json)) {
      if ($b.n_prompt -gt 0) { $esito.lettura_tok_s = [math]::Round($b.avg_ts, 1) } else { $esito.scrittura_tok_s = [math]::Round($b.avg_ts, 1) }
      if ($b.cpu_info) { $esito.cpu_llama = $b.cpu_info }
    }
  } catch { $Risultati.note += "llama-bench non ha risposto per $($m.nome)" }
  Scrivi ("  Lettura {0} token/s, scrittura {1} token/s" -f $esito.lettura_tok_s, $esito.scrittura_tok_s)

  Scrivi '  Avvio del modello...'
  $porta = 8099
  $logServer = Join-Path $Qui 'registro-server.txt'
  $argomenti = @('-m', "`"$file`"", '--port', $porta, '-t', $thread, '-tb', $thread, '-c', '8192', '-np', '1', '--jinja', '--no-webui', '-cram', '0')
  $t0 = Get-Date
  $p = Start-Process -FilePath (Join-Path $Llama 'llama-server.exe') -ArgumentList $argomenti -PassThru -NoNewWindow `
       -RedirectStandardError $logServer -RedirectStandardOutput (Join-Path $Qui 'registro-server-out.txt')
  $pronto = $false
  while (((Get-Date) - $t0).TotalSeconds -lt 300) {
    if ($p.HasExited) { break }
    try { Invoke-RestMethod -Uri "http://127.0.0.1:$porta/health" -TimeoutSec 2 | Out-Null; $pronto = $true; break } catch { Start-Sleep -Milliseconds 300 }
  }
  if (-not $pronto) {
    $esito.esito = 'il modello non si è avviato (vedi registro-server.txt)'
    try { $p.Kill() } catch { }
    return $esito
  }
  $esito.caricamento_s = [math]::Round(((Get-Date) - $t0).TotalSeconds, 1)
  Scrivi "  Pronto in $($esito.caricamento_s) s. Ora le domande sui documenti di prova:"

  $giuste = 0; $pagine = 0; $n = 0
  try {
    foreach ($d in $doc) {
      $r = Chiedi $porta $d.testo 'Estrai importo principale, CIG, CUP e responsabile del procedimento (RUP). Se un dato non c''è scrivi null. Rispondi SOLO con un oggetto JSON.' 200 $schemaDati
      $esito.compiti += [ordered]@{ documento = $d.id; compito = 'estrazione dati (prima lettura del documento)'; secondi = $r.secondi; token_letti = $r.timings.prompt_n }
      Scrivi ("    {0}: lettura ed estrazione {1} s" -f $d.id, $r.secondi)
      foreach ($q in $d.domande) {
        $n++
        $compito = "Domanda: $($q.domanda)`nRispondi in modo breve usando solo il documento e indica il numero della pagina ('=== Pagina N ===') in cui si trova la risposta. Rispondi SOLO con un oggetto JSON {""risposta"": ..., ""pagina"": ...}."
        $r = Chiedi $porta $d.testo $compito 120 $schemaDomanda
        $risp = $null; try { $risp = $r.testo | ConvertFrom-Json } catch { }
        $ok = $false
        foreach ($a in $q.accettabili) { $na = Normalizza $a; if ($na -and (Normalizza $risp.risposta).Contains($na)) { $ok = $true } }
        $pg = ($risp -and $risp.pagina -eq $q.pagina)
        if ($ok) { $giuste++ }; if ($ok -and $pg) { $pagine++ }
        $esito.compiti += [ordered]@{ documento = $d.id; compito = 'domanda'; secondi = $r.secondi; giusta = $ok; pagina_giusta = $pg }
        Scrivi ("    domanda: {0} s - {1}" -f $r.secondi, $(if ($ok) { 'giusta' } else { 'sbagliata' }))
      }
      if (-not $Breve -and $d.id -like '02-*') {
        $r = Chiedi $porta $d.testo 'Scrivi un riassunto del documento in 5 frasi brevi, in italiano corretto, usando solo informazioni presenti.' 300 $null
        $esito.compiti += [ordered]@{ documento = $d.id; compito = 'riassunto'; secondi = $r.secondi }
        $esito.esempio_riassunto = $r.testo
        Scrivi ("    riassunto: {0} s" -f $r.secondi)
      }
    }
  } catch {
    $esito.esito = "errore durante le prove: $_"
  }
  $p.Refresh()
  $esito.ram_picco_gb = [math]::Round($p.PeakWorkingSet64 / 1GB, 2)
  $esito.domande = $n; $esito.risposte_giuste = $giuste; $esito.pagine_giuste = $pagine
  try { $p.Kill(); $p.WaitForExit(10000) | Out-Null } catch { }
  $sys = Get-Content -Path $logServer -ErrorAction SilentlyContinue | Select-String -Pattern 'system_info' | Select-Object -First 1
  if ($sys) { $esito.system_info = $sys.Line.Trim() }
  return $esito
}

$i = 2
foreach ($m in $elenco) {
  Titolo ("{0}. Modello {1}" -f $i, $m.nome); $i++
  if (-not (Prepara-Modello $m)) {
    $Risultati.modelli += [ordered]@{ nome = $m.nome; esito = 'non scaricato (rete bloccata o file diverso): vedi le istruzioni per copiarlo a mano' }
    continue
  }
  $Risultati.modelli += (Prova-Modello $m)
}

$f = Salva-Risultati
Titolo 'Fatto'
Scrivi "  Grazie! Il file dei risultati è sul Desktop:" 'Green'
Scrivi "  $f" 'Green'
Scrivi '  Rimandalo per e-mail così com''è.'
if (-not $Breve) { try { Start-Process explorer.exe -ArgumentList "/select,`"$f`"" } catch { } }
$fallite = @($Risultati.modelli | Where-Object { $_.esito -ne 'ok' }).Count
if ($Breve -and $fallite -gt 0) { exit 1 }
exit 0
