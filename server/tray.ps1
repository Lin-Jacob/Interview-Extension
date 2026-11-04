# LeetCode Daily Lock - tray icon for the friends dashboard (Windows).
# Shows a dot next to the clock:
#   green  running and online through ngrok
#   yellow running on this PC only (no tunnel, or ngrok is reconnecting)
#   red    not running
# Right-click for Open dashboard, Start, Stop, Restart, Open log and Exit.
# Started by `npm run tray`, and at sign-in by `npm run autostart`.
# Written for Windows PowerShell 5.1 (built into Windows), so no newer syntax.
param([string]$Node = "")

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$DataDir = Join-Path $Here "data"
$StatusFile = Join-Path $DataDir "status.json"
$PidFile = Join-Path $DataDir "dashboard.pid"
$LogFile = Join-Path $DataDir "dashboard.log"
$StartJs = Join-Path $Here "start.js"

# One tray icon at a time.
$created = $false
$mutex = New-Object System.Threading.Mutex($true, "Local\LeetCodeDailyLockDashboardTray", [ref]$created)
if (-not $created) { exit 0 }

if (-not $Node) {
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if ($cmd) { $Node = $cmd.Source }
}

function Read-Status {
  try { return (Get-Content -Raw -LiteralPath $StatusFile | ConvertFrom-Json) } catch { return $null }
}

# PORT from .env, like start.js; status.json wins once the dashboard has run.
function Get-Port($s) {
  if ($s -and $s.port) { return [int]$s.port }
  $envFile = Join-Path $Here ".env"
  if (Test-Path -LiteralPath $envFile) {
    foreach ($line in Get-Content -LiteralPath $envFile) {
      if ($line -match '^\s*PORT\s*=\s*["'']?(\d+)') { return [int]$Matches[1] }
    }
  }
  return 8787
}

function Test-Port([int]$port) {
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $async = $client.BeginConnect("127.0.0.1", $port, $null, $null)
    if (-not $async.AsyncWaitHandle.WaitOne(800)) { return $false }
    $client.EndConnect($async)
    return $true
  } catch { return $false } finally { $client.Close() }
}

function New-DotIcon([System.Drawing.Color]$color) {
  $bmp = New-Object System.Drawing.Bitmap 32, 32
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([System.Drawing.Color]::Transparent)
  $brush = New-Object System.Drawing.SolidBrush $color
  $pen = New-Object System.Drawing.Pen -ArgumentList ([System.Drawing.Color]::FromArgb(200, 20, 20, 20)), 2
  $g.FillEllipse($brush, 3, 3, 26, 26)
  $g.DrawEllipse($pen, 3, 3, 26, 26)
  $g.Dispose(); $brush.Dispose(); $pen.Dispose()
  return [System.Drawing.Icon]::FromHandle($bmp.GetHicon())
}

$Icons = @{
  online  = New-DotIcon ([System.Drawing.Color]::FromArgb(255, 46, 160, 67))
  local   = New-DotIcon ([System.Drawing.Color]::FromArgb(255, 230, 170, 20))
  stopped = New-DotIcon ([System.Drawing.Color]::FromArgb(255, 210, 50, 50))
}

$tray = New-Object System.Windows.Forms.NotifyIcon
$tray.Icon = $Icons.stopped
$tray.Text = "LeetCode dashboard"
$tray.Visible = $true

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$miStatus = $menu.Items.Add("Checking...")
$miStatus.Enabled = $false
[void]$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))
$miOpen = $menu.Items.Add("Open dashboard")
$miStart = $menu.Items.Add("Start dashboard")
$miStop = $menu.Items.Add("Stop dashboard")
$miRestart = $menu.Items.Add("Restart dashboard")
$miLog = $menu.Items.Add("Open log")
[void]$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))
$miExit = $menu.Items.Add("Exit tray icon")
$tray.ContextMenuStrip = $menu

$script:state = $null
$script:url = ""

function Get-DashboardPid {
  $s = Read-Status
  $id = 0
  if ($s -and $s.pid) { $id = [int]$s.pid }
  elseif (Test-Path -LiteralPath $PidFile) { [int]::TryParse((Get-Content -Raw -LiteralPath $PidFile).Trim(), [ref]$id) | Out-Null }
  return $id
}

function Start-Dashboard {
  if (-not $Node) {
    $tray.ShowBalloonTip(5000, "Can't start the dashboard", "Node.js wasn't found. Install it, or run npm run tray again from the server folder.", "Error")
    return
  }
  Start-Process -FilePath $Node -ArgumentList @("`"$StartJs`"", "--log") -WorkingDirectory $Here -WindowStyle Hidden
}

function Stop-Dashboard {
  $id = Get-DashboardPid
  if ($id -le 0) { return }
  $p = Get-Process -Id $id -ErrorAction SilentlyContinue
  # Only stop it if that id is still a node process (ids get reused).
  if ($p -and $p.ProcessName -eq "node") { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue }
}

function Update-Tray {
  $s = Read-Status
  $port = Get-Port $s
  $running = Test-Port $port
  if (-not $running) {
    $new = "stopped"; $text = "Not running"; $script:url = ""
  } elseif ($s -and $s.online -and $s.url) {
    $new = "online"; $text = "Online at $($s.url)"; $script:url = [string]$s.url
  } else {
    $new = "local"; $script:url = "http://localhost:$port"
    if ($s -and $s.local) { $text = "Running on this PC only (npm run local)" }
    elseif ($s -and $s.problem) { $text = "This PC only: $($s.problem)" }
    else { $text = "Running on this PC only" }
  }

  $tray.Icon = $Icons[$new]
  $tip = "LeetCode dashboard: $text"
  if ($tip.Length -gt 63) { $tip = $tip.Substring(0, 60) + "..." }  # Windows limit
  $tray.Text = $tip
  $miStatus.Text = $text
  $miOpen.Enabled = $running
  $miStart.Enabled = -not $running
  $miStop.Enabled = $running
  $miRestart.Enabled = $running

  # Pop up a note when it goes down or comes back, but not on the first check.
  if ($script:state -and $script:state -ne $new) {
    if ($new -eq "stopped") { $tray.ShowBalloonTip(5000, "Dashboard stopped", "Friends can't see the dashboard or sync. Right-click the tray icon to start it.", "Warning") }
    elseif ($new -eq "local" -and $script:state -eq "online") { $tray.ShowBalloonTip(5000, "Dashboard offline", $text, "Warning") }
    elseif ($new -eq "online") { $tray.ShowBalloonTip(3000, "Dashboard online", $text, "Info") }
  }
  $script:state = $new
}

$miOpen.add_Click({ if ($script:url) { Start-Process $script:url } })
$tray.add_DoubleClick({ if ($script:url) { Start-Process $script:url } })
$miStart.add_Click({ Start-Dashboard; $miStatus.Text = "Starting..."; $miStart.Enabled = $false })
$miStop.add_Click({ Stop-Dashboard; Start-Sleep -Milliseconds 500; Update-Tray })
$miRestart.add_Click({ Stop-Dashboard; Start-Sleep -Milliseconds 1500; Start-Dashboard; $miStatus.Text = "Restarting..." })
$miLog.add_Click({
  if (Test-Path -LiteralPath $LogFile) { Start-Process notepad.exe -ArgumentList "`"$LogFile`"" }
  else { $tray.ShowBalloonTip(4000, "No log yet", "The log is written when the dashboard runs in the background (npm run autostart or Start here).", "Info") }
})
$miExit.add_Click({
  $timer.Stop()
  $tray.Visible = $false
  $tray.Dispose()
  [System.Windows.Forms.Application]::Exit()
})

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 5000
$timer.add_Tick({ try { Update-Tray } catch { } })

# From here on, a failed action shouldn't close the tray icon.
$ErrorActionPreference = "Continue"
try { Update-Tray } catch { }
$timer.Start()
[System.Windows.Forms.Application]::Run()

$tray.Dispose()
$mutex.ReleaseMutex()
